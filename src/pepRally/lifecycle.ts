/**
 * Every change to the Pep Rally library, as pure functions. Changes that involve files are
 * split into a "begin" step, saved before any file is touched, and a "complete" step, so an
 * interruption at any point leaves enough in storage for `recovery.ts` to finish or undo it.
 */

import { AccessDenial, canCreate, canReplaceAudio, canUseProExtras, fitsDuration, PepAccess, PepUpsell, upsellFor } from './access';
import { AudioExtension, isAudioExtension, isPepRallyId, isPhotoExtension, MAX_REVISION, mediaFileName, PhotoExtension } from './files';
import {
  DEFAULT_PEP_TITLE,
  filesOf,
  findRally,
  normalizeTags,
  normalizeTitle,
  PepAudio,
  PepLibrary,
  PepPhoto,
  PepRally,
  PepSource,
  PepTag,
  PepVoice,
} from './model';

export type PepError =
  | 'notReady'
  | 'readOnly'
  | 'storageUnavailable'
  | 'noMediaStore'
  | 'busy'
  | 'notFound'
  /** Subscription status isn't verified yet. Never a reason to offer Pro. */
  | 'checking'
  /** Pro can't be bought in this build, so nothing new can be added. */
  | 'unavailable'
  /** Free allowance used up. */
  | 'limitReached'
  /** Pro's 50 are all in use. */
  | 'libraryFull'
  | 'tooLong'
  | 'invalidAudio'
  | 'invalidPhoto'
  | 'invalidTitle'
  | 'invalidTags'
  | 'consentRequired'
  | 'proRequired'
  | 'saveFailed'
  | 'mediaFailed'
  /** The saved file couldn't be confirmed as excluded from backups, so the save wasn't finished. */
  | 'notProtected'
  /** The take was opened for a different action or recording, or its file is no longer the recording it saved before. */
  | 'takeMismatch'
  /** The file couldn't be confirmed as the recording that was made, so it wasn't saved. */
  | 'mediaUnverified'
  /** The take or file was there before "Reset everything", so it was deleted instead of saved. */
  | 'discarded';

/** Storage failures where trying the same take again can succeed. Every other failure is final for that attempt. */
export const RETRYABLE_ERRORS: readonly PepError[] = ['saveFailed', 'mediaFailed', 'notProtected'];

/** `upsell` is present only when verified Free access is what stood in the way. */
export type PepFailure = { ok: false; error: PepError; upsell?: PepUpsell };
export type PepResult = { ok: true; library: PepLibrary; rally: PepRally | null } | PepFailure;

export type AudioDraft = { extension: AudioExtension; durationMs: number; byteSize: number | null };
export type PhotoDraft = { extension: PhotoExtension; width: number | null; height: number | null };

export type CreateDraft = {
  title: string;
  source: PepSource;
  voice: PepVoice;
  /** The person confirmed the speaker agreed. Required for someone else's voice. */
  consentConfirmed: boolean;
  audio: AudioDraft;
  tags?: PepTag[];
  favorite?: boolean;
};

export type ReplacementDraft = { audio?: AudioDraft; photo?: PhotoDraft };

const fail = (error: PepError, upsell?: PepUpsell): PepFailure => (upsell ? { ok: false, error, upsell } : { ok: false, error });
const deny = (denial: AccessDenial): PepFailure => fail(denial.error, denial.upsell);

function update(library: PepLibrary, id: string, at: Date, change: (rally: PepRally) => PepRally | null): PepLibrary {
  const rallies: PepRally[] = [];
  for (const rally of library.rallies) {
    if (rally.id !== id) rallies.push(rally);
    else {
      const next = change(rally);
      if (next) rallies.push(next);
    }
  }
  return { ...library, rallies, updatedAt: at.toISOString() };
}

const done = (library: PepLibrary, id: string): PepResult => ({ ok: true, library, rally: findRally(library, id) ?? null });

/** A rally the person can see and change. Pending and deleting rallies aren't. */
function visible(library: PepLibrary, id: string): PepRally | PepError {
  const rally = findRally(library, id);
  return rally && rally.status === 'ready' ? rally : 'notFound';
}

function audioError(draft: AudioDraft, maxDurationMs: number): PepError | null {
  if (!isAudioExtension(draft.extension)) return 'invalidAudio';
  if (draft.byteSize !== null && !(Number.isInteger(draft.byteSize) && draft.byteSize >= 0)) return 'invalidAudio';
  if (!Number.isInteger(draft.durationMs) || draft.durationMs <= 0) return 'invalidAudio';
  return fitsDuration(draft.durationMs, maxDurationMs) ? null : 'tooLong';
}

/** Too long for Free is a reason to offer Pro; too long for Pro is not. */
function audioFailure(library: PepLibrary, draft: AudioDraft, maxDurationMs: number, access: PepAccess): PepFailure | null {
  const problem = audioError(draft, maxDurationMs);
  if (!problem) return null;
  return problem === 'tooLong' ? fail(problem, upsellFor(library, access)) : fail(problem);
}

function photoError(draft: PhotoDraft): PepError | null {
  const side = (value: number | null) => value === null || (Number.isInteger(value) && value >= 1 && value <= 100_000);
  return isPhotoExtension(draft.extension) && side(draft.width) && side(draft.height) ? null : 'invalidPhoto';
}

/**
 * Step 1 of saving: records the new rally as pending. Its audio file is moved into place next.
 * `takeLimitMs` is the length the take was opened with; it can lower the tier's limit, never raise it.
 */
export function beginCreate(library: PepLibrary, id: string, draft: CreateDraft, access: PepAccess, at: Date, takeLimitMs?: number): PepResult {
  if (!isPepRallyId(id) || findRally(library, id)) return fail('busy');
  const title = normalizeTitle(draft.title);
  if (!title) return fail('invalidTitle');
  if (draft.voice === 'someoneElse' && draft.consentConfirmed !== true) return fail('consentRequired');
  const allowed = canCreate(library, access);
  if (!allowed.ok) return deny(allowed);
  const problem = audioFailure(library, draft.audio, Math.min(allowed.maxDurationMs, takeLimitMs ?? Infinity), access);
  if (problem) return problem;
  const tags = normalizeTags(draft.tags ?? []);
  if (!tags) return fail('invalidTags');
  if (tags.length || draft.favorite) {
    const extras = canUseProExtras(library, access);
    if (!extras.ok) return deny(extras);
  }

  const stamp = at.toISOString();
  const rally: PepRally = {
    id,
    title,
    status: 'pending',
    createdAt: stamp,
    updatedAt: stamp,
    source: draft.source === 'import' ? 'import' : 'microphone',
    voice: draft.voice === 'someoneElse' ? 'someoneElse' : 'mine',
    consentConfirmedAt: draft.voice === 'someoneElse' ? stamp : null,
    audio: { fileName: mediaFileName(id, 'audio', 1, draft.audio.extension), durationMs: draft.audio.durationMs, byteSize: draft.audio.byteSize },
    photo: null,
    tags,
    favorite: draft.favorite === true,
    lastPlayedAt: null,
    revision: 1,
    replacing: null,
    retiredFiles: [],
  };
  return { ok: true, library: { ...library, rallies: [...library.rallies, rally], updatedAt: stamp }, rally };
}

/** Step 2 of saving, once the audio is in place. Does nothing to a rally that was deleted meanwhile. */
export function completeCreate(library: PepLibrary, id: string, at: Date): PepResult {
  const rally = findRally(library, id);
  if (!rally) return fail('notFound');
  if (rally.status !== 'pending') return done(library, id);
  return done(update(library, id, at, (current) => ({ ...current, status: 'ready', updatedAt: at.toISOString() })), id);
}

/** Saving stopped before the audio was moved into place, so nothing was saved. */
export function abandonCreate(library: PepLibrary, id: string, at: Date): PepLibrary {
  const rally = findRally(library, id);
  return rally?.status === 'pending' ? update(library, id, at, () => null) : library;
}

/** A save that won't be finished although its audio may be in place: the rally is deleted with its file. */
export function discardCreate(library: PepLibrary, id: string, at: Date): PepLibrary {
  const rally = findRally(library, id);
  return rally?.status === 'pending' ? update(library, id, at, (current) => ({ ...current, status: 'deleting' })) : library;
}

export function rename(library: PepLibrary, id: string, title: string, at: Date): PepResult {
  const rally = visible(library, id);
  if (typeof rally === 'string') return fail(rally);
  const next = normalizeTitle(title);
  if (!next) return fail('invalidTitle');
  if (next === rally.title) return done(library, id);
  return done(update(library, id, at, (current) => ({ ...current, title: next, updatedAt: at.toISOString() })), id);
}

export function markPlayed(library: PepLibrary, id: string, at: Date): PepResult {
  const rally = visible(library, id);
  if (typeof rally === 'string') return fail(rally);
  return done(update(library, id, at, (current) => ({ ...current, lastPlayedAt: at.toISOString() })), id);
}

/** Adding a tag needs Pro; removing tags never does. */
export function setTags(library: PepLibrary, id: string, tags: readonly PepTag[], access: PepAccess, at: Date): PepResult {
  const rally = visible(library, id);
  if (typeof rally === 'string') return fail(rally);
  const next = normalizeTags(tags);
  if (!next) return fail('invalidTags');
  if (next.some((tag) => !rally.tags.includes(tag))) {
    const extras = canUseProExtras(library, access);
    if (!extras.ok) return deny(extras);
  }
  return done(update(library, id, at, (current) => ({ ...current, tags: next, updatedAt: at.toISOString() })), id);
}

/** Marking a favorite needs Pro; unmarking never does. */
export function setFavorite(library: PepLibrary, id: string, favorite: boolean, access: PepAccess, at: Date): PepResult {
  const rally = visible(library, id);
  if (typeof rally === 'string') return fail(rally);
  if (favorite && !rally.favorite) {
    const extras = canUseProExtras(library, access);
    if (!extras.ok) return deny(extras);
  }
  if (favorite === rally.favorite) return done(library, id);
  return done(update(library, id, at, (current) => ({ ...current, favorite, updatedAt: at.toISOString() })), id);
}

/**
 * Step 1 of replacing the audio or photo: records the new file names. New audio follows the
 * current tier's length limit, and without Pro only a library within the Free allowance can be
 * re-recorded; a new photo needs Pro. The current media stays in use until step 2.
 */
export function beginReplacement(
  library: PepLibrary,
  id: string,
  draft: ReplacementDraft,
  access: PepAccess,
  at: Date,
  takeLimitMs?: number,
): PepResult {
  const rally = visible(library, id);
  if (typeof rally === 'string') return fail(rally);
  if (rally.replacing) return fail('busy');
  if (!draft.audio && !draft.photo) return fail('invalidAudio');
  if (draft.photo) {
    const extras = canUseProExtras(library, access);
    if (!extras.ok) return deny(extras);
    const problem = photoError(draft.photo);
    if (problem) return fail(problem);
  }
  if (draft.audio) {
    const allowed = canReplaceAudio(library, access);
    if (!allowed.ok) return deny(allowed);
    const problem = audioFailure(library, draft.audio, Math.min(allowed.maxDurationMs, takeLimitMs ?? Infinity), access);
    if (problem) return problem;
  }
  const revision = rally.revision + 1;
  if (revision > MAX_REVISION) return fail('busy');
  const audio: PepAudio | null = draft.audio
    ? { fileName: mediaFileName(id, 'audio', revision, draft.audio.extension), durationMs: draft.audio.durationMs, byteSize: draft.audio.byteSize }
    : null;
  const photo: PepPhoto | null = draft.photo
    ? { fileName: mediaFileName(id, 'photo', revision, draft.photo.extension), width: draft.photo.width, height: draft.photo.height }
    : null;
  return done(update(library, id, at, (current) => ({ ...current, revision, replacing: { audio, photo } })), id);
}

/** Step 2 of replacing, once the new files are in place. The old files are retired for deletion. */
export function completeReplacement(library: PepLibrary, id: string, at: Date, present?: ReadonlySet<string>): PepResult {
  const rally = findRally(library, id);
  if (!rally) return fail('notFound');
  if (!rally.replacing || rally.status === 'deleting') return done(library, id);
  return done(
    update(library, id, at, (current) => {
      const { replacing } = current;
      if (!replacing) return current;
      const audio = replacing.audio && (!present || present.has(replacing.audio.fileName)) ? replacing.audio : null;
      const photo = replacing.photo && (!present || present.has(replacing.photo.fileName)) ? replacing.photo : null;
      const retired = [...current.retiredFiles];
      if (audio) retired.push(current.audio.fileName);
      if (photo && current.photo) retired.push(current.photo.fileName);
      return {
        ...current,
        audio: audio ?? current.audio,
        photo: photo ?? current.photo,
        replacing: null,
        retiredFiles: retired,
        updatedAt: audio || photo ? at.toISOString() : current.updatedAt,
      };
    }),
    id,
  );
}

/** Replacing stopped early. Any new file that did arrive is retired, so it is deleted too. */
export function abandonReplacement(library: PepLibrary, id: string, at: Date): PepLibrary {
  const rally = findRally(library, id);
  if (!rally?.replacing) return library;
  return update(library, id, at, (current) => {
    const leftovers = [current.replacing?.audio?.fileName, current.replacing?.photo?.fileName].filter((name): name is string => !!name);
    return { ...current, replacing: null, retiredFiles: [...current.retiredFiles, ...leftovers] };
  });
}

/** Always allowed, with or without Pro. */
export function removePhoto(library: PepLibrary, id: string, at: Date): PepResult {
  const rally = visible(library, id);
  if (typeof rally === 'string') return fail(rally);
  if (rally.replacing) return fail('busy');
  if (!rally.photo) return done(library, id);
  const old = rally.photo.fileName;
  return done(
    update(library, id, at, (current) => ({ ...current, photo: null, retiredFiles: [...current.retiredFiles, old], updatedAt: at.toISOString() })),
    id,
  );
}

/** Step 1 of deleting, always allowed: the rally disappears at once and its files are removed next. */
export function beginDelete(library: PepLibrary, id: string, at: Date): PepResult {
  const rally = visible(library, id);
  if (typeof rally === 'string') return fail(rally);
  if (rally.replacing) return fail('busy');
  return done(update(library, id, at, (current) => ({ ...current, status: 'deleting' })), id);
}

/** Undoes step 1 when it couldn't be saved, so the rally isn't lost from view while it is still stored. */
export function cancelDelete(library: PepLibrary, id: string, at: Date): PepLibrary {
  return findRally(library, id)?.status === 'deleting' ? update(library, id, at, (current) => ({ ...current, status: 'ready' })) : library;
}

/** What a reset rally keeps until its files are gone: only the names needed to delete them. */
function erased(rally: PepRally, stamp: string): PepRally {
  const audio = (media: PepAudio): PepAudio => ({ fileName: media.fileName, durationMs: null, byteSize: null });
  const photo = (media: PepPhoto | null): PepPhoto | null => (media ? { fileName: media.fileName, width: null, height: null } : null);
  return {
    id: rally.id,
    title: DEFAULT_PEP_TITLE,
    status: 'deleting',
    createdAt: stamp,
    updatedAt: stamp,
    source: 'microphone',
    voice: 'mine',
    consentConfirmedAt: null,
    audio: audio(rally.audio),
    photo: photo(rally.photo),
    tags: [],
    favorite: false,
    lastPlayedAt: null,
    revision: rally.revision,
    replacing: rally.replacing
      ? { audio: rally.replacing.audio ? audio(rally.replacing.audio) : null, photo: photo(rally.replacing.photo) }
      : null,
    retiredFiles: [...rally.retiredFiles],
  };
}

/**
 * "Reset everything": every rally, including one still being saved, is marked for deletion,
 * and its title, tags and other details are erased at once rather than when its files go. The
 * reset is marked as pending in the same change, until `endReset`.
 */
export function beginReset(library: PepLibrary, at: Date): PepLibrary {
  const stamp = at.toISOString();
  const rallies = library.rallies.map((rally) => erased(rally, rally.status === 'deleting' ? rally.updatedAt : stamp));
  if (library.pendingReset && JSON.stringify(rallies) === JSON.stringify(library.rallies)) return library;
  return { ...library, rallies, updatedAt: stamp, pendingReset: library.pendingReset ?? stamp };
}

/** Every file the reset covered is confirmed gone. */
export function endReset(library: PepLibrary): PepLibrary {
  if (library.pendingReset === undefined) return library;
  const { pendingReset: _done, ...rest } = library;
  return rest;
}

export type OwnedFile = { id: string; fileName: string };

/** Files that should no longer exist: everything of a deleting rally, and retired files of the rest. */
export function filesToDelete(library: PepLibrary, except: ReadonlySet<string> = new Set()): OwnedFile[] {
  const files: OwnedFile[] = [];
  for (const rally of library.rallies) {
    if (except.has(rally.id)) continue;
    const names = rally.status === 'deleting' ? filesOf(rally) : rally.retiredFiles;
    for (const fileName of names) files.push({ id: rally.id, fileName });
  }
  return files;
}

/**
 * Forgets files that are confirmed gone. A deleting rally is removed once all of its files are
 * gone; rallies listed in `except` (an operation is still running on them) are left as they are.
 */
export function forgetFiles(library: PepLibrary, gone: ReadonlySet<string>, at: Date, except: ReadonlySet<string> = new Set()): PepLibrary {
  let changed = false;
  const rallies: PepRally[] = [];
  for (const rally of library.rallies) {
    if (except.has(rally.id)) {
      rallies.push(rally);
      continue;
    }
    if (rally.status === 'deleting' && filesOf(rally).every((name) => gone.has(name))) {
      changed = true;
      continue;
    }
    const retiredFiles = rally.retiredFiles.filter((name) => !gone.has(name));
    if (retiredFiles.length !== rally.retiredFiles.length) {
      changed = true;
      rallies.push({ ...rally, retiredFiles });
    } else rallies.push(rally);
  }
  return changed ? { ...library, rallies, updatedAt: at.toISOString() } : library;
}
