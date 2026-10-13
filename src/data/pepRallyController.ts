import {
  isPepDirectoryUri,
  isPepMediaFileName,
  isStagedFileName,
  newPepRallyId,
  parseMediaFileName,
  PEP_MEDIA_DIRECTORY,
  PEP_STAGING_DIRECTORY,
} from '../pepRally/files';
import {
  abandonCreate,
  abandonReplacement,
  beginCreate,
  beginDelete,
  beginReplacement,
  beginReset,
  cancelDelete,
  completeCreate,
  completeReplacement,
  CreateDraft,
  filesToDelete,
  forgetFiles,
  markPlayed,
  PepError,
  PepFailure,
  PepResult,
  removePhoto,
  rename,
  ReplacementDraft,
  setFavorite,
  setTags,
} from '../pepRally/lifecycle';
import { isPepAccess, PepAccess } from '../pepRally/access';
import type { PepMediaStore } from '../pepRally/media';
import { defaultPepLibrary, filesOf, findRally, isNewerLibrary, PepLibrary, PepRally, PepTag } from '../pepRally/model';
import { emptyRecoveryReport, PepRecoveryReport, recoverLibrary } from '../pepRally/recovery';
import { deleteRecordingFiles } from './recordings';
import { createWriteQueue } from './writeQueue';

export type PepActionResult = { ok: true; rally: PepRally | null } | PepFailure;
export type PepCleanupResult = { ok: boolean; failed: string[] };

/** Why "Reset everything" could not confirm that every Pep Rally file and detail is gone. */
export type PepResetProblem = 'storageUnavailable' | 'saveFailed' | 'noMediaStore' | 'mediaFailed' | 'filesRemain';
/**
 * `ok` only when the metadata is saved empty and neither folder still holds a Pep Rally file.
 * `failed` lists URIs that could not be deleted; `remaining` lists names still found afterwards,
 * including a take a recording session still has open, which is deleted when it is released.
 */
export type PepResetResult = { ok: boolean; reason: PepResetProblem | null; failed: string[]; remaining: string[] };

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
  /**
   * Opened with verified Pro: its first save may use Pro limits even if Pro has ended since.
   * Used up by that attempt, whatever its result, or by releasing the take. Never stored.
   */
  proAllowance: boolean;
};

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

  /**
   * Access for saving these takes, using up their allowances: Pro if every one was opened with
   * verified Pro, otherwise current access. Never Pro where Pep Rallies are unavailable.
   */
  function accessForTakes(names: readonly (string | undefined)[]): PepAccess {
    const open = names.filter((name): name is string => !!name).map((name) => takes.get(name));
    const allowed = open.length > 0 && open.every((take) => take?.proAllowance === true);
    for (const take of open) if (take) take.proAllowance = false;
    const current = currentAccess();
    return allowed && current !== 'unavailable' ? 'pro' : current;
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
    return deleteRecordingFiles(
      store.stagingUri,
      names.filter(isStagedFileName).map((fileName) => ({ id: fileName, fileName })),
      (uri) => store.deleteFile(uri),
    );
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

  return {
    current: () => library,
    isReady: () => ready,
    /** Resolves once every change so far has been written, or has failed. */
    flush: () => queue.flush(),
    /** What the last recovery found, for showing missing files. */
    health: (): PepRecoveryReport => report,

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

    /** Connects device storage. Refused unless both folders are Puphii's own. */
    attachMedia(store: PepMediaStore): boolean {
      if (!isPepDirectoryUri(store.libraryUri, PEP_MEDIA_DIRECTORY) || !isPepDirectoryUri(store.stagingUri, PEP_STAGING_DIRECTORY)) return false;
      media = store;
      return true;
    },

    /**
     * A recording session or import is about to write this staged take. Until it is released,
     * clearing the staging folder leaves it alone. Refused while a reset is running. Whether
     * access is verified Pro is captured now, for this take only.
     */
    openTake(stagedName: string): boolean {
      if (!ready || resetting || !isStagedFileName(stagedName) || takes.has(stagedName)) return false;
      takes.set(stagedName, { opened: resets, proAllowance: currentAccess() === 'pro' });
      return true;
    },

    /** The session is over, saved, discarded or cancelled. A take opened before a reset is deleted now. */
    async releaseTake(stagedName: string): Promise<void> {
      const stale = isStaleTake(stagedName);
      takes.delete(stagedName);
      if (stale && media) await deleteStaged(media, [stagedName]).catch(() => undefined);
    },

    /** Finishes or undoes interrupted changes. Run at launch, before anything is recorded. */
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
            const recovered = recoverLibrary(library, files, now());
            report = recovered.report;
            commit(recovered.library);
            if (!(await persisted())) return fail('saveFailed');
            const cleaned = await cleanUp();
            if (clearStaged) await clearStaging(store).catch(() => undefined);
            return cleaned.ok ? succeed(null) : fail('mediaFailed');
          } finally {
            recovering = false;
          }
        })(),
      );
    },

    /** Saves a staged take or import as a new rally, with Pro limits only if the take was opened with Pro or access is Pro now. */
    async create(draft: CreateDraft, stagedName: string): Promise<PepActionResult> {
      const access = accessForTakes([stagedName]);
      const problem = blocked(true) ?? (recovering || resetting ? 'busy' : null);
      if (problem) return fail(problem);
      if (!isStagedFileName(stagedName)) return fail('invalidAudio');
      if (isStaleTake(stagedName)) return discard([stagedName]);
      const at = now();
      const id = newId(at);
      const begun = beginCreate(library, id, draft, access, at);
      if (!begun.ok) return begun;
      const fileName = begun.rally!.audio.fileName;
      const store = media as PepMediaStore;
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
          // pending and recovery decides at the next launch.
          const arrived = await moved(store, [[stagedName, fileName]]);
          if (arrived === null) return fail('mediaFailed');
          if (!arrived) {
            commit(abandonCreate(library, id, now()));
            await persisted();
            return fail('mediaFailed');
          }
        }
        const completed = completeCreate(library, id, now());
        if (completed.ok) commit(completed.library);
        await persisted();
        return succeed(id);
      });
    },

    /** Swaps in new audio, a new photo, or both. The old files are deleted once the new ones are saved. */
    async replace(id: string, draft: ReplacementDraft, staged: { audio?: string; photo?: string }): Promise<PepActionResult> {
      const access = accessForTakes([staged.audio, staged.photo]);
      const problem = blocked(true) ?? (recovering || resetting || inFlight.has(id) ? 'busy' : null);
      if (problem) return fail(problem);
      if (!!draft.audio !== isStagedFileName(staged.audio) || !!draft.photo !== isStagedFileName(staged.photo)) {
        return fail(draft.audio ? 'invalidAudio' : 'invalidPhoto');
      }
      if (isStaleTake(staged.audio) || isStaleTake(staged.photo)) return discard([staged.audio, staged.photo]);
      const begun = beginReplacement(library, id, draft, access, now());
      if (!begun.ok) return begun;
      const target = begun.rally!.replacing!;
      const store = media as PepMediaStore;
      const stagedNames = [staged.audio, staged.photo].filter((name): name is string => !!name);
      return exclusive(id, stagedNames, async () => {
        commit(begun.library);
        if (!(await persisted())) {
          commit(abandonReplacement(library, id, now()));
          return fail('saveFailed');
        }
        try {
          if (target.audio && staged.audio) await store.adopt(staged.audio, target.audio.fileName);
          if (target.photo && staged.photo) await store.adopt(staged.photo, target.photo.fileName);
        } catch {
          // All or nothing: finished only if every new file is known to be in place. Otherwise the
          // old media stays, and any new file that did arrive is retired and deleted.
          const moves: [string, string][] = [];
          if (target.audio && staged.audio) moves.push([staged.audio, target.audio.fileName]);
          if (target.photo && staged.photo) moves.push([staged.photo, target.photo.fileName]);
          if ((await moved(store, moves)) !== true) {
            commit(abandonReplacement(library, id, now()));
            await persisted();
            return fail('mediaFailed');
          }
        }
        const completed = completeReplacement(library, id, now());
        if (completed.ok) commit(completed.library);
        await persisted();
        return succeed(id);
      });
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
     * "Reset everything": every rally is hidden, its details erased and the change saved first.
     * New saves, recoveries and takes are refused until it finishes, and ones already running are
     * waited for. Then every Pep Rally file and unsaved take is deleted, and both folders are
     * checked. Anything left is retried at the next launch, and the result is not `ok`.
     */
    async reset(): Promise<PepResetResult> {
      const result = (reason: PepResetProblem | null, failed: string[] = [], remaining: string[] = []): PepResetResult => ({
        ok: reason === null,
        reason,
        failed,
        remaining,
      });
      if (!ready || !canSave) return result('storageUnavailable');
      resets += 1;
      resetting += 1;
      try {
        commit(beginReset(library, now()));
        if (!(await persisted())) return result('saveFailed');
        await Promise.allSettled([...operations]);
        const store = media;
        if (!store) return result('noMediaStore');

        const cleaned = await cleanUp(true);
        let failed = [...cleaned.failed];
        try {
          failed = [...failed, ...(await clearStaging(store)).failed];
        } catch {
          return result('mediaFailed', failed);
        }
        let remaining: string[];
        try {
          const [inLibrary, inStaging] = await Promise.all([store.listLibrary(), store.listStaging()]);
          remaining = [...inLibrary.filter(isPepMediaFileName), ...inStaging.filter(isStagedFileName)];
        } catch {
          return result('mediaFailed', failed);
        }
        if (failed.length || remaining.length || library.rallies.length) return result('filesRemain', failed, remaining);
        if (!cleaned.ok || !(await persisted())) return result('saveFailed');
        return result(null);
      } finally {
        resetting -= 1;
      }
    },
  };
}

export type PepRallyController = ReturnType<typeof createPepRallyController>;
