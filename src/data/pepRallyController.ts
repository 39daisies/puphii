import {
  isAudioExtension,
  isPepDirectoryUri,
  isPepMediaFileName,
  isSavedMediaUri,
  isStagedFileName,
  newPepRallyId,
  parseMediaFileName,
  PEP_STAGING_DIRECTORY,
} from '../pepRally/files';
import {
  abandonCreate,
  abandonReplacement,
  AudioDraft,
  beginCreate,
  beginDelete,
  beginReplacement,
  beginReset,
  cancelDelete,
  completeCreate,
  completeReplacement,
  CreateDraft,
  discardCreate,
  endReset,
  filesToDelete,
  forgetFiles,
  markPlayed,
  PepError,
  PepFailure,
  PepResult,
  removePhoto,
  rename,
  ReplacementDraft,
  RETRYABLE_ERRORS,
  setFavorite,
  setTags,
} from '../pepRally/lifecycle';
import { canCreate, canReplaceAudio, CreateCheck, isPepAccess, PepAccess } from '../pepRally/access';
import type { PepMediaStore } from '../pepRally/media';
import { defaultPepLibrary, filesOf, findRally, isNewerLibrary, PepLibrary, PepRally, PepTag } from '../pepRally/model';
import { arrivedFiles, emptyRecoveryReport, PepRecoveryReport, recoverLibrary } from '../pepRally/recovery';
import { deleteRecordingFiles } from './recordings';
import { createWriteQueue } from './writeQueue';

export type PepActionResult = { ok: true; rally: PepRally | null } | PepFailure;
export type PepCleanupResult = { ok: boolean; failed: string[] };

/** What a recording session is for: a new rally, or new audio for one that exists. */
export type PepTakePurpose = { kind: 'create' } | { kind: 'replaceAudio'; id: string };
/** `maxDurationMs`: the longest audio this take may save. The recorder stops there. */
export type PepTakeResult = { ok: true; maxDurationMs: number } | PepFailure;

/** Why "Reset everything" could not confirm that every Pep Rally file and detail is gone. */
export type PepResetProblem = 'storageUnavailable' | 'saveFailed' | 'noMediaStore' | 'mediaFailed' | 'filesRemain';
/**
 * `ok` only when the metadata is saved empty and neither folder still holds a Pep Rally file.
 * `failed` lists URIs that could not be deleted; `remaining` lists names still found afterwards,
 * including a take a recording session still has open, which is deleted when it is released.
 */
export type PepResetResult = { ok: boolean; reason: PepResetProblem | null; failed: string[]; remaining: string[] };

const resetResult = (reason: PepResetProblem | null, failed: string[] = [], remaining: string[] = []): PepResetResult => ({
  ok: reason === null,
  reason,
  failed,
  remaining,
});

export type PepRallyControllerOptions = {
  /** Writes the whole library. Must reject if the write fails. Writes are queued here, newest wins. */
  write: (library: PepLibrary) => Promise<void>;
  /** Shows the new library in the UI. */
  publish?: (library: PepLibrary) => void;
  onSaveError?: (error: unknown) => void;
  onSaveSuccess?: () => void;
  now?: () => Date;
  newId?: (at: Date) => string;
  /** Current Pep Rally access, read whenever an action depends on it. Until one is connected, access is `checking`. */
  access?: () => PepAccess;
};

type OpenTake = {
  /** The reset count when the take was opened. */
  opened: number;
  purpose: PepTakePurpose;
  /** The longest audio this take may save, fixed when it was opened. Upgrading later doesn't raise it. */
  maxDurationMs: number;
  /**
   * Opened with verified Pro: its save may use Pro limits even if Pro has ended since. Used up by
   * each save attempt, and given back only when that attempt failed for a retryable storage
   * reason and the take's file is fingerprinted. Ends when the take is released. Never stored.
   */
  proAllowance: boolean;
  /** The audio its first save attempt used. */
  attempted: AudioDraft | null;
  /**
   * SHA-256 of the file its first attempt with the allowance saved: a retry keeps the allowance
   * only for those exact bytes. `undefined` until that attempt; `null` if none could be taken
   * or the file proved different, so no retry has the allowance.
   */
  identity: string | null | undefined;
};

/** What one save attempt may do, decided before it starts. */
type AttemptTerms = {
  access: PepAccess;
  /** The fingerprint the saved audio must still have once it is in place, or null when nothing is bound. */
  identity: string | null;
  /** Why the attempt is refused before it starts: its file isn't provably the one first attempted. */
  refused: PepError | null;
  keep(): void;
};

/**
 * A save stopped after its files may have moved into the library: finished by saving the same
 * take again, undone by releasing it, or settled by recovery at the next launch. Never stored.
 */
type Unfinished = {
  kind: 'create' | 'replace';
  id: string;
  /** The staged names this save used. Each one leads back to it. */
  staged: string[];
  moves: [staged: string, fileName: string][];
  audio: AudioDraft | undefined;
  /** The reset count when it started. */
  opened: number;
  /** The audio file in the library and the fingerprint it must have before the save is finished. */
  identity: { fileName: string; print: string } | null;
};

const SHA256_HEX = /^[0-9a-f]{64}$/;

const sameAudio = (a: AudioDraft | null | undefined, b: AudioDraft | null | undefined): boolean =>
  !a || !b ? !a && !b : a.extension === b.extension && a.durationMs === b.durationMs && a.byteSize === b.byteSize;

const inUse = (rally: PepRally): string[] => [rally.audio.fileName, ...(rally.photo ? [rally.photo.fileName] : [])];

/**
 * Holds the Pep Rally library between loading and saving, like the plan controller. The library
 * here is the synchronous source of truth. Anything involving files waits until the step before
 * it has been written, so storage always describes a state recovery can finish or undo.
 */
export function createPepRallyController(options: PepRallyControllerOptions) {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? ((at: Date) => newPepRallyId(at));
  let library = defaultPepLibrary();
  let ready = false;
  let canSave = false;
  let lastWriteFailed = false;
  let media: PepMediaStore | null = null;
  let report = emptyRecoveryReport();
  let recovering = false;
  // Rallies with a file operation in progress. Cleanup leaves them alone until it finishes.
  const inFlight = new Set<string>();
  // Staged takes a running save is moving. Clearing the staging folder leaves them alone.
  const busyStaged = new Set<string>();
  // Takes a recording session or import has open.
  const takes = new Map<string, OpenTake>();
  // Saves waiting to be finished or undone, by staged name.
  const unfinished = new Map<string, Unfinished>();
  // Staged files a reset covers: there when it began or while it was being finished. Never saved,
  // and their names never opened as takes, until each is confirmed gone.
  const staleStaged = new Set<string>();
  // Whether staging has been listed, this session, for the reset still pending. Until it has,
  // nothing staged can be told apart from what that reset covers.
  let staleKnown = false;
  let accessSource = options.access ?? null;
  // Saves, replacements and recoveries still running, which a reset waits for.
  const operations = new Set<Promise<unknown>>();
  let resets = 0;
  let resetting = 0;

  const queue = createWriteQueue<PepLibrary>(
    (value) => (canSave ? options.write(value) : Promise.resolve()),
    (error) => {
      lastWriteFailed = true;
      options.onSaveError?.(error);
    },
    () => {
      lastWriteFailed = false;
      options.onSaveSuccess?.();
    },
  );

  function commit(next: PepLibrary) {
    if (next === library) return;
    library = next;
    queue.save(next);
    options.publish?.(next);
  }

  /** True once the current library is on disk. */
  async function persisted(): Promise<boolean> {
    await queue.flush();
    return canSave && !lastWriteFailed;
  }

  function blocked(needsMedia: boolean): PepError | null {
    if (!ready) return 'notReady';
    if (!canSave) return 'storageUnavailable';
    if (isNewerLibrary(library)) return 'readOnly';
    if (needsMedia && !media) return 'noMediaStore';
    return null;
  }

  /** Read at the moment an action runs, never taken from the caller. Anything unexpected counts as `checking`. */
  function currentAccess(): PepAccess {
    try {
      const access = accessSource?.();
      return isPepAccess(access) ? access : 'checking';
    } catch {
      return 'checking';
    }
  }

  /** The file's SHA-256 as reported by the media store, or null for anything that isn't one. */
  async function fingerprintOf(folder: 'staging' | 'library', fileName: string | undefined): Promise<string | null> {
    if (!media || !fileName) return null;
    try {
      const print: unknown = await media.fingerprint?.(folder, fileName);
      return typeof print === 'string' && SHA256_HEX.test(print) ? print : null;
    } catch {
      return null;
    }
  }

  /**
   * Access for one save attempt with these takes, using up their allowances. Pro if every one was
   * opened with verified Pro and, on a retry, it is provably the same recording: the same audio
   * details and the same file bytes as fingerprinted on the first attempt. Otherwise current
   * access. Never Pro where Pep Rallies are unavailable. A retry whose file differs, or can't be
   * fingerprinted, is refused and the allowance is gone for good. `keep` gives an allowance back
   * after a retryable failure, and only while a fingerprint binds the take to its file.
   */
  async function attempt(names: readonly (string | undefined)[], audio: AudioDraft | undefined): Promise<AttemptTerms> {
    const open = names.filter((name): name is string => !!name).map((name) => [name, takes.get(name)] as const);
    let allowed =
      open.length > 0 && open.every(([, take]) => take?.proAllowance === true && (take.attempted === null || sameAudio(take.attempted, audio)));
    for (const [, take] of open) {
      if (!take) continue;
      take.proAllowance = false;
      take.attempted ??= audio ?? null;
    }
    let refused: PepError | null = null;
    const [name, take] = open[0] ?? [];
    if (allowed && name && take) {
      const waiting = unfinished.get(name);
      const print = waiting
        ? await fingerprintOf('library', waiting.moves.find(([staged]) => staged === name)?.[1])
        : await fingerprintOf('staging', name);
      if (take.identity === undefined) take.identity = print;
      else if (take.identity === null) allowed = false;
      else if (print !== take.identity) {
        refused = print === null ? 'mediaUnverified' : 'takeMismatch';
        take.identity = null;
        allowed = false;
      }
    }
    const granted = allowed;
    const current = currentAccess();
    return {
      access: granted && current !== 'unavailable' ? 'pro' : current,
      identity: granted && take?.identity ? take.identity : null,
      refused,
      keep() {
        if (granted && name && take && takes.get(name) === take && typeof take.identity === 'string') take.proAllowance = true;
      },
    };
  }

  /** The take's file proved different, or couldn't be checked: no later attempt has its allowance. */
  function invalidate(names: readonly string[]) {
    for (const name of names) {
      const take = takes.get(name);
      if (!take) continue;
      take.proAllowance = false;
      take.identity = null;
    }
  }

  /** A pending reset whose staging hasn't been listed this session: nothing staged may be saved or opened yet. */
  const stagingUnknown = (): boolean => library.pendingReset !== undefined && !staleKnown;

  /**
   * Marks every file now in staging as covered by the reset, except takes opened since it began,
   * and forgets stale names confirmed gone. Until a listing succeeds, staging stays unknown.
   */
  async function markStale(store: PepMediaStore) {
    try {
      const present = (await store.listStaging()).filter(isStagedFileName);
      for (const name of [...staleStaged]) if (!present.includes(name)) staleStaged.delete(name);
      for (const name of present) if (takes.get(name)?.opened !== resets) staleStaged.add(name);
      staleKnown = true;
    } catch {
      // Stays unknown: saves from staging wait while the reset is pending.
    }
  }

  const fail = (error: PepError): PepActionResult => ({ ok: false, error });
  const succeed = (id: string | null): PepActionResult => ({ ok: true, rally: id ? (findRally(library, id) ?? null) : null });

  function apply(result: PepResult): PepActionResult {
    if (!result.ok) return result;
    commit(result.library);
    return { ok: true, rally: result.rally };
  }

  function metadataChange(change: (current: PepLibrary, at: Date) => PepResult): PepActionResult {
    const problem = blocked(false);
    return problem ? fail(problem) : apply(change(library, now()));
  }

  function track<T>(work: Promise<T>): Promise<T> {
    operations.add(work);
    work.finally(() => operations.delete(work)).catch(() => undefined);
    return work;
  }

  /** Opened before the latest reset, so it must not be saved. */
  const isStaleTake = (name: string | undefined): boolean => {
    const take = name === undefined ? undefined : takes.get(name);
    return take !== undefined && take.opened < resets;
  };

  async function deleteStaged(store: PepMediaStore, names: readonly string[]) {
    const result = await deleteRecordingFiles(
      store.stagingUri,
      names.filter(isStagedFileName).map((fileName) => ({ id: fileName, fileName })),
      (uri) => store.deleteFile(uri),
    );
    for (const uri of result.deleted) staleStaged.delete(uri.slice(store.stagingUri.length));
    return result;
  }

  /**
   * After a move reported an error: true only if every target is in the library and its take has
   * left staging (a file that was already there doesn't count), null if the folders can't be read.
   */
  async function moved(store: PepMediaStore, moves: readonly [staged: string, fileName: string][]): Promise<boolean | null> {
    try {
      const [inLibrary, inStaging] = await Promise.all([store.listLibrary(), store.listStaging()]);
      return moves.every(([staged, fileName]) => inLibrary.includes(fileName) && !inStaging.includes(staged));
    } catch {
      return null;
    }
  }

  /** Each file must confirm by itself that it is excluded from backups. No answer, or any other answer, is a failure. */
  async function confirmedExcluded(store: PepMediaStore, names: readonly string[]): Promise<boolean> {
    if (!names.length) return false;
    for (const name of names) {
      try {
        if ((await store.excludeFromBackup(name)) !== true) return false;
      } catch {
        return false;
      }
    }
    return true;
  }

  /** Deletes files that should no longer exist, plus, for a reset, Pep Rally files no rally lists. */
  async function cleanUp(includeUnlisted = false): Promise<PepCleanupResult> {
    const store = media;
    if (!store || !canSave) return { ok: true, failed: [] };
    const targets = filesToDelete(library, inFlight);
    if (includeUnlisted) {
      try {
        const listed = new Set(library.rallies.flatMap(filesOf));
        for (const name of await store.listLibrary()) {
          const owner = parseMediaFileName(name)?.owner;
          if (owner && !listed.has(name) && !inFlight.has(owner)) targets.push({ id: owner, fileName: name });
        }
      } catch {
        return { ok: false, failed: [] };
      }
    }
    if (!targets.length) return { ok: true, failed: [] };
    const result = await deleteRecordingFiles(store.libraryUri, targets, (uri) => store.deleteFile(uri));
    const gone = new Set(result.deleted.map((uri) => uri.slice(store.libraryUri.length)));
    commit(forgetFiles(library, gone, now(), inFlight));
    const saved = await persisted();
    return { ok: saved && !result.failed.length && !result.skipped.length, failed: result.failed };
  }

  /** Deletes unsaved takes, except ones a save is moving or a recording session has open. */
  async function clearStaging(store: PepMediaStore) {
    const staged = (await store.listStaging()).filter((name) => !busyStaged.has(name) && !takes.has(name));
    return deleteStaged(store, staged);
  }

  /**
   * The part of "Reset everything" that deletes files, also used to finish one that was
   * interrupted. The pending mark is removed only once both folders hold no Pep Rally file except
   * those of rallies saved since, and that is saved.
   */
  async function completeReset(store: PepMediaStore): Promise<PepResetResult> {
    await markStale(store);
    const cleaned = await cleanUp(true);
    let failed = [...cleaned.failed];
    try {
      failed = [...failed, ...(await clearStaging(store)).failed];
    } catch {
      return resetResult('mediaFailed', failed);
    }
    let remaining: string[];
    try {
      const [inLibrary, inStaging] = await Promise.all([store.listLibrary(), store.listStaging()]);
      for (const name of [...staleStaged]) if (!inStaging.includes(name)) staleStaged.delete(name);
      const kept = new Set(library.rallies.filter((rally) => rally.status !== 'deleting').flatMap(filesOf));
      remaining = [...inLibrary.filter((name) => isPepMediaFileName(name) && !kept.has(name)), ...inStaging.filter(isStagedFileName)];
    } catch {
      return resetResult('mediaFailed', failed);
    }
    if (failed.length || remaining.length || library.rallies.some((rally) => rally.status === 'deleting')) {
      return resetResult('filesRemain', failed, remaining);
    }
    if (!cleaned.ok) return resetResult('saveFailed');
    commit(endReset(library));
    if (!(await persisted())) return resetResult('saveFailed');
    return resetResult(null);
  }

  /** Runs a file operation on one rally, then removes whatever a delete or reset left behind meanwhile. */
  function exclusive(id: string, staged: readonly string[], work: () => Promise<PepActionResult>): Promise<PepActionResult> {
    inFlight.add(id);
    staged.forEach((name) => busyStaged.add(name));
    return track(
      (async () => {
        try {
          return await work();
        } finally {
          inFlight.delete(id);
          staged.forEach((name) => busyStaged.delete(name));
          await cleanUp().catch(() => undefined);
        }
      })(),
    );
  }

  /** A take recorded before a reset: deleted rather than saved. */
  async function discard(names: readonly (string | undefined)[]): Promise<PepActionResult> {
    const store = media as PepMediaStore;
    await deleteStaged(store, names.filter((name): name is string => !!name)).catch(() => undefined);
    return fail('discarded');
  }

  function remember(entry: Unfinished) {
    if (entry.opened === resets) for (const name of entry.staged) unfinished.set(name, entry);
  }

  function forget(entry: Unfinished) {
    for (const name of entry.staged) if (unfinished.get(name) === entry) unfinished.delete(name);
  }

  /**
   * The file in place isn't provably the recording that was made: the save is undone and hidden,
   * its file deleted, and the take's allowance is gone for good. Never a retryable failure.
   */
  async function undo(entry: Unfinished, error: 'takeMismatch' | 'mediaUnverified'): Promise<PepActionResult> {
    forget(entry);
    invalidate(entry.staged);
    commit(entry.kind === 'create' ? discardCreate(library, entry.id, now()) : abandonReplacement(library, entry.id, now()));
    await persisted();
    return fail(error);
  }

  /**
   * The files are in place: finished only once the audio still has the fingerprint its attempt
   * bound, if any, and each file is confirmed as excluded from backups.
   */
  async function finish(entry: Unfinished, store: PepMediaStore): Promise<PepActionResult> {
    if (entry.identity) {
      const print = await fingerprintOf('library', entry.identity.fileName);
      if (print !== entry.identity.print) return undo(entry, print === null ? 'mediaUnverified' : 'takeMismatch');
    }
    if (!(await confirmedExcluded(store, entry.moves.map(([, fileName]) => fileName)))) {
      remember(entry);
      return fail('notProtected');
    }
    forget(entry);
    const completed = entry.kind === 'create' ? completeCreate(library, entry.id, now()) : completeReplacement(library, entry.id, now());
    if (completed.ok) commit(completed.library);
    await persisted();
    return succeed(entry.id);
  }

  /**
   * Saving the same take again after a retryable failure: picks up where that save stopped.
   * `recheck` applies this attempt's own terms as if the save were starting now, so a retry that
   * no longer holds an allowance gets no more than current access allows.
   */
  async function resume(entry: Unfinished, recheck: () => PepFailure | null): Promise<PepActionResult> {
    if (entry.opened !== resets) {
      forget(entry);
      return discard(entry.staged);
    }
    const rally = findRally(library, entry.id);
    const targets = entry.moves.map(([, fileName]) => fileName);
    const stillOpen =
      entry.kind === 'create'
        ? rally?.status === 'pending'
        : rally?.status === 'ready' &&
          targets.every((name) => name === rally.replacing?.audio?.fileName || name === rally.replacing?.photo?.fileName);
    if (!stillOpen) {
      forget(entry);
      return rally?.status === 'ready' && targets.every((name) => inUse(rally).includes(name)) ? succeed(entry.id) : fail('notFound');
    }
    if (inFlight.has(entry.id)) return fail('busy');
    const refused = recheck();
    if (refused) return refused;
    const store = media as PepMediaStore;
    return exclusive(entry.id, entry.staged, async () => {
      const arrived = await moved(store, entry.moves);
      if (arrived === null) return fail('mediaFailed');
      // Its file left the library, or its take came back to staging: what is there now isn't provably this recording.
      if (!arrived) return undo(entry, 'takeMismatch');
      return finish(entry, store);
    });
  }

  /** The take was released before its save finished: the save is undone and any file it moved is deleted. */
  function abandonUnfinished(entry: Unfinished): Promise<void> {
    forget(entry);
    if (entry.opened !== resets || inFlight.has(entry.id) || blocked(true)) return Promise.resolve();
    const rally = findRally(library, entry.id);
    if (entry.kind === 'create' && rally?.status === 'pending') commit(discardCreate(library, entry.id, now()));
    else if (entry.kind === 'replace' && rally?.replacing && rally.status !== 'deleting') commit(abandonReplacement(library, entry.id, now()));
    else return Promise.resolve();
    return track(
      (async () => {
        if (await persisted()) await cleanUp();
      })(),
    );
  }

  /** A retry whose file isn't provably the one first attempted: an unfinished save of that take is undone too. */
  async function refuse(stagedName: string | undefined, error: PepError): Promise<PepActionResult> {
    const waiting = stagedName ? unfinished.get(stagedName) : undefined;
    if (waiting) await abandonUnfinished(waiting);
    return fail(error);
  }

  async function createAttempt(draft: CreateDraft, stagedName: string, terms: AttemptTerms): Promise<PepActionResult> {
    const { access } = terms;
    const problem = blocked(true) ?? (recovering || resetting || stagingUnknown() ? 'busy' : null);
    if (problem) return fail(problem);
    if (!isStagedFileName(stagedName)) return fail('invalidAudio');
    if (staleStaged.has(stagedName)) return discard([stagedName]);
    const take = takes.get(stagedName);
    if (take && take.purpose.kind !== 'create') return fail('takeMismatch');
    const waiting = unfinished.get(stagedName);
    if (waiting) {
      if (waiting.kind !== 'create' || !sameAudio(waiting.audio, draft.audio)) return fail('takeMismatch');
      return resume(waiting, () => {
        const others = { ...library, rallies: library.rallies.filter((rally) => rally.id !== waiting.id) };
        const check = beginCreate(others, waiting.id, draft, access, now(), take?.maxDurationMs);
        return check.ok ? null : check;
      });
    }
    if (isStaleTake(stagedName)) return discard([stagedName]);
    const at = now();
    const id = newId(at);
    const begun = beginCreate(library, id, draft, access, at, take?.maxDurationMs);
    if (!begun.ok) return begun;
    const fileName = begun.rally!.audio.fileName;
    const store = media as PepMediaStore;
    const entry: Unfinished = {
      kind: 'create',
      id,
      staged: [stagedName],
      moves: [[stagedName, fileName]],
      audio: draft.audio,
      opened: resets,
      identity: terms.identity ? { fileName, print: terms.identity } : null,
    };
    return exclusive(id, [stagedName], async () => {
      commit(begun.library);
      if (!(await persisted())) {
        commit(abandonCreate(library, id, now()));
        return fail('saveFailed');
      }
      try {
        await store.adopt(stagedName, fileName);
      } catch {
        // The move may have finished before it failed. If that can't be checked, the save stays
        // pending: saving the same take again, or recovery at the next launch, decides.
        const arrived = await moved(store, entry.moves);
        if (arrived === null) {
          remember(entry);
          return fail('mediaFailed');
        }
        if (!arrived) {
          commit(abandonCreate(library, id, now()));
          await persisted();
          return fail('mediaFailed');
        }
      }
      return finish(entry, store);
    });
  }

  async function replaceAttempt(
    id: string,
    draft: ReplacementDraft,
    staged: { audio?: string; photo?: string },
    terms: AttemptTerms,
  ): Promise<PepActionResult> {
    const { access } = terms;
    const problem = blocked(true) ?? (recovering || resetting || stagingUnknown() || inFlight.has(id) ? 'busy' : null);
    if (problem) return fail(problem);
    if (!!draft.audio !== isStagedFileName(staged.audio) || !!draft.photo !== isStagedFileName(staged.photo)) {
      return fail(draft.audio ? 'invalidAudio' : 'invalidPhoto');
    }
    if ([staged.audio, staged.photo].some((name) => name && staleStaged.has(name))) return discard([staged.audio, staged.photo]);
    const take = staged.audio ? takes.get(staged.audio) : undefined;
    if (take && !(take.purpose.kind === 'replaceAudio' && take.purpose.id === id)) return fail('takeMismatch');
    const stagedNames = [staged.audio, staged.photo].filter((name): name is string => !!name);
    const waiting = stagedNames.map((name) => unfinished.get(name)).find((entry) => entry !== undefined);
    if (waiting) {
      const same =
        waiting.kind === 'replace' &&
        waiting.id === id &&
        sameAudio(waiting.audio, draft.audio) &&
        waiting.staged.length === stagedNames.length &&
        stagedNames.every((name) => waiting.staged.includes(name));
      if (!same) return fail('takeMismatch');
      return resume(waiting, () => {
        const cleared = { ...library, rallies: library.rallies.map((rally) => (rally.id === id ? { ...rally, replacing: null } : rally)) };
        const check = beginReplacement(cleared, id, draft, access, now(), take?.maxDurationMs);
        return check.ok ? null : check;
      });
    }
    if (isStaleTake(staged.audio) || isStaleTake(staged.photo)) return discard([staged.audio, staged.photo]);
    const begun = beginReplacement(library, id, draft, access, now(), take?.maxDurationMs);
    if (!begun.ok) return begun;
    const target = begun.rally!.replacing!;
    const store = media as PepMediaStore;
    const moves: [string, string][] = [];
    if (target.audio && staged.audio) moves.push([staged.audio, target.audio.fileName]);
    if (target.photo && staged.photo) moves.push([staged.photo, target.photo.fileName]);
    const entry: Unfinished = {
      kind: 'replace',
      id,
      staged: stagedNames,
      moves,
      audio: draft.audio,
      opened: resets,
      identity: terms.identity && target.audio && staged.audio ? { fileName: target.audio.fileName, print: terms.identity } : null,
    };
    return exclusive(id, stagedNames, async () => {
      commit(begun.library);
      if (!(await persisted())) {
        commit(abandonReplacement(library, id, now()));
        return fail('saveFailed');
      }
      try {
        for (const [stagedName, fileName] of moves) await store.adopt(stagedName, fileName);
      } catch {
        // All or nothing: finished only if every new file is known to be in place. Otherwise the
        // old media stays, and any new file that did arrive is retired and deleted.
        if ((await moved(store, moves)) !== true) {
          commit(abandonReplacement(library, id, now()));
          await persisted();
          return fail('mediaFailed');
        }
      }
      return finish(entry, store);
    });
  }

  return {
    current: () => library,
    isReady: () => ready,
    /** Resolves once every change so far has been written, or has failed. */
    flush: () => queue.flush(),
    /** What the last recovery found, for showing missing files. Emptied by a reset. */
    health: (): PepRecoveryReport => report,
    /** A reset started but not every file it covers is confirmed gone yet. It is finished at the next launch. */
    resetPending: (): boolean => library.pendingReset !== undefined,

    /** Takes the library as loaded. Nothing is written unless something changes it. */
    load(loaded: PepLibrary, { canSave: writable }: { canSave: boolean }) {
      library = loaded;
      canSave = writable;
      ready = true;
      options.publish?.(loaded);
    },

    /** Connects where current access comes from, replacing any earlier source. */
    connectAccess(source: (() => PepAccess) | null) {
      accessSource = source;
    },

    /**
     * Connects device storage. Refused unless both folders are Puphii's own, and the saved media
     * folder is outside Documents, Caches and tmp: there is no other place to fall back to.
     */
    attachMedia(store: PepMediaStore): boolean {
      if (!isSavedMediaUri(store.libraryUri) || !isPepDirectoryUri(store.stagingUri, PEP_STAGING_DIRECTORY)) return false;
      media = store;
      return true;
    },

    /**
     * A recording session or import is about to write this staged audio. Refused unless saving it
     * could be allowed now: subscription status, the number saved, and storage are all checked.
     * Returns the longest audio this take may save, which stays fixed for it. Until it is
     * released, clearing the staging folder leaves it alone. Whether access is verified Pro is
     * captured now, for this take only.
     */
    openTake(stagedName: string, purpose: PepTakePurpose = { kind: 'create' }): PepTakeResult {
      const problem = blocked(true) ?? (resetting || stagingUnknown() ? 'busy' : null);
      if (problem) return { ok: false, error: problem };
      if (!isStagedFileName(stagedName) || !isAudioExtension(stagedName.slice(stagedName.lastIndexOf('.') + 1))) {
        return { ok: false, error: 'invalidAudio' };
      }
      if (takes.has(stagedName) || unfinished.has(stagedName) || staleStaged.has(stagedName)) return { ok: false, error: 'busy' };
      const access = currentAccess();
      let allowed: CreateCheck;
      if (purpose?.kind === 'create') allowed = canCreate(library, access);
      else if (purpose?.kind === 'replaceAudio') {
        const rally = findRally(library, purpose.id);
        if (!rally || rally.status !== 'ready') return { ok: false, error: 'notFound' };
        if (rally.replacing || inFlight.has(rally.id)) return { ok: false, error: 'busy' };
        allowed = canReplaceAudio(library, access);
      } else return { ok: false, error: 'takeMismatch' };
      if (!allowed.ok) return allowed;
      const purposeCopy: PepTakePurpose = purpose.kind === 'create' ? { kind: 'create' } : { kind: 'replaceAudio', id: purpose.id };
      takes.set(stagedName, {
        opened: resets,
        purpose: purposeCopy,
        maxDurationMs: allowed.maxDurationMs,
        proAllowance: access === 'pro',
        attempted: null,
        identity: undefined,
      });
      return { ok: true, maxDurationMs: allowed.maxDurationMs };
    },

    /**
     * The session is over, saved, discarded or cancelled. A save of it that wasn't finished is
     * undone, and any file it moved is deleted. A take opened before a reset is deleted now.
     */
    async releaseTake(stagedName: string): Promise<void> {
      const stale = isStaleTake(stagedName);
      takes.delete(stagedName);
      const waiting = unfinished.get(stagedName);
      if (waiting) await abandonUnfinished(waiting);
      if (stale && media) await deleteStaged(media, [stagedName]).catch(() => undefined);
    },

    /**
     * Finishes or undoes interrupted changes. Run at launch, before anything is recorded. An
     * interrupted reset is finished first, and until it is, no unlisted file is ever reported.
     */
    recover({ clearStaged = true }: { clearStaged?: boolean } = {}): Promise<PepActionResult> {
      const problem = blocked(true);
      if (problem) return Promise.resolve(fail(problem));
      if (recovering || resetting || inFlight.size) return Promise.resolve(fail('busy'));
      const store = media as PepMediaStore;
      recovering = true;
      return track(
        (async (): Promise<PepActionResult> => {
          try {
            let files: string[];
            try {
              files = await store.listLibrary();
            } catch {
              return fail('mediaFailed');
            }
            const unprotected = new Set<string>();
            for (const name of arrivedFiles(library, files)) if (!(await confirmedExcluded(store, [name]))) unprotected.add(name);
            const recovered = recoverLibrary(library, files, now(), unprotected);
            const finishingReset = library.pendingReset !== undefined;
            report = finishingReset ? { ...recovered.report, unlisted: [] } : recovered.report;
            commit(recovered.library);
            if (!(await persisted())) return fail('saveFailed');
            if (finishingReset) {
              const finished = await completeReset(store);
              if (finished.ok) return succeed(null);
              return fail(finished.reason === 'saveFailed' ? 'saveFailed' : 'mediaFailed');
            }
            const cleaned = await cleanUp();
            if (clearStaged) await clearStaging(store).catch(() => undefined);
            return cleaned.ok ? succeed(null) : fail('mediaFailed');
          } finally {
            recovering = false;
          }
        })(),
      );
    },

    /**
     * Saves a staged take or import as a new rally. Pro limits apply only if the take was opened
     * with Pro and its allowance is still held, or access is Pro now. An opened take never saves
     * audio longer than it was opened for. The rally is finished only once its file is confirmed
     * as excluded from backups; after a retryable failure, saving the same take again continues.
     */
    async create(draft: CreateDraft, stagedName: string): Promise<PepActionResult> {
      const terms = await attempt([stagedName], draft.audio);
      if (terms.refused) return refuse(stagedName, terms.refused);
      const result = await createAttempt(draft, stagedName, terms);
      if (!result.ok && RETRYABLE_ERRORS.includes(result.error)) terms.keep();
      return result;
    },

    /**
     * Swaps in new audio, a new photo, or both. The old files are deleted once the new ones are in
     * place and confirmed as excluded from backups. New audio from an opened take must have been
     * opened for this rally.
     */
    async replace(id: string, draft: ReplacementDraft, staged: { audio?: string; photo?: string }): Promise<PepActionResult> {
      const terms = await attempt([staged.audio, staged.photo], draft.audio);
      if (terms.refused) return refuse(staged.audio, terms.refused);
      const result = await replaceAttempt(id, draft, staged, terms);
      if (!result.ok && RETRYABLE_ERRORS.includes(result.error)) terms.keep();
      return result;
    },

    rename: (id: string, title: string) => metadataChange((current, at) => rename(current, id, title, at)),
    markPlayed: (id: string) => metadataChange((current, at) => markPlayed(current, id, at)),
    setTags: (id: string, tags: readonly PepTag[]) => metadataChange((current, at) => setTags(current, id, tags, currentAccess(), at)),
    setFavorite: (id: string, favorite: boolean) => metadataChange((current, at) => setFavorite(current, id, favorite, currentAccess(), at)),

    async removePhoto(id: string): Promise<PepActionResult> {
      const problem = blocked(false) ?? (inFlight.has(id) ? 'busy' : null);
      if (problem) return fail(problem);
      const result = apply(removePhoto(library, id, now()));
      if (!result.ok) return result;
      if (await persisted()) await cleanUp();
      return succeed(id);
    },

    /** Hides the rally at once; its files are deleted now, or at the next launch if that fails. */
    async delete(id: string): Promise<PepActionResult> {
      const problem = blocked(false) ?? (inFlight.has(id) ? 'busy' : null);
      if (problem) return fail(problem);
      const result = apply(beginDelete(library, id, now()));
      if (!result.ok) return result;
      const resetsBefore = resets;
      if (!(await persisted())) {
        // A reset meanwhile already erased the rally; bringing it back would show an empty recording.
        if (resets === resetsBefore) commit(cancelDelete(library, id, now()));
        return fail('saveFailed');
      }
      await cleanUp();
      return succeed(null);
    },

    /**
     * "Reset everything": every rally is hidden, its details erased and the reset marked as pending,
     * all saved before any file is touched. New saves, recoveries and takes are refused until it
     * finishes, and ones already running are waited for. Then every Pep Rally file and unsaved take
     * is deleted, and both folders are checked. Anything left keeps the reset pending: it is
     * finished at the next launch, and the result is not `ok`. Running it again is always safe.
     */
    async reset(): Promise<PepResetResult> {
      if (!ready || !canSave) return resetResult('storageUnavailable');
      resets += 1;
      resetting += 1;
      staleKnown = false;
      // Nothing a reset covers is ever offered back, even if deleting it fails.
      report = emptyRecoveryReport();
      try {
        commit(beginReset(library, now()));
        if (!(await persisted())) return resetResult('saveFailed');
        const store = media;
        if (store) await markStale(store);
        await Promise.allSettled([...operations]);
        if (!store) return resetResult('noMediaStore');
        return await completeReset(store);
      } finally {
        resetting -= 1;
      }
    },
  };
}

export type PepRallyController = ReturnType<typeof createPepRallyController>;
