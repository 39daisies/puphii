/**
 * Where Pep Rally media lives and what it may be called. Every name is generated from a
 * rally id, never from user input or an imported file's name, so a stored name can only
 * ever point at a file directly inside Puphii's own media folder.
 */

/** Saved audio and photos, in an app-private folder excluded from device backups. */
export const PEP_MEDIA_DIRECTORY = 'pep-rallies';
/** Takes and imports before they are saved. */
export const PEP_STAGING_DIRECTORY = 'pep-rally-staging';

export const AUDIO_EXTENSIONS = ['m4a', 'aac', 'caf', 'wav', 'mp3', 'aiff'] as const;
export const PHOTO_EXTENSIONS = ['jpg', 'png', 'heic'] as const;
export type AudioExtension = (typeof AUDIO_EXTENSIONS)[number];
export type PhotoExtension = (typeof PHOTO_EXTENSIONS)[number];
export type MediaKind = 'audio' | 'photo';

export const MAX_REVISION = 999999;

const ID = /^pr-[0-9a-z]{1,12}-[0-9a-z]{8}$/;
const MEDIA_NAME = /^(pr-[0-9a-z]{1,12}-[0-9a-z]{8})-([ap])([1-9][0-9]{0,5})\.([a-z0-9]{3,4})$/;
const STAGED_NAME = /^stage-[0-9a-z]{1,40}\.([a-z0-9]{3,4})$/;

export const isAudioExtension = (value: unknown): value is AudioExtension =>
  (AUDIO_EXTENSIONS as readonly unknown[]).includes(value);
export const isPhotoExtension = (value: unknown): value is PhotoExtension =>
  (PHOTO_EXTENSIONS as readonly unknown[]).includes(value);

export const isPepRallyId = (value: unknown): value is string => typeof value === 'string' && ID.test(value);

/** A stable id: creation time plus randomness, so ids never repeat even across reinstalls on one device. */
export function newPepRallyId(at: Date, random: () => number = Math.random): string {
  let suffix = '';
  while (suffix.length < 8) suffix += Math.floor(random() * 36).toString(36);
  return `pr-${Math.max(0, at.getTime()).toString(36)}-${suffix}`;
}

export function mediaFileName(id: string, kind: MediaKind, revision: number, extension: AudioExtension | PhotoExtension): string {
  return `${id}-${kind === 'audio' ? 'a' : 'p'}${revision}.${extension}`;
}

export type MediaName = { owner: string; kind: MediaKind; revision: number };

/** What a saved media file name says about itself, or null if Puphii couldn't have named it. */
export function parseMediaFileName(fileName: unknown): MediaName | null {
  if (typeof fileName !== 'string') return null;
  const match = MEDIA_NAME.exec(fileName);
  if (!match) return null;
  const kind: MediaKind = match[2] === 'a' ? 'audio' : 'photo';
  if (kind === 'audio' ? !isAudioExtension(match[4]) : !isPhotoExtension(match[4])) return null;
  return { owner: match[1], kind, revision: Number(match[3]) };
}

export const isPepMediaFileName = (fileName: unknown): fileName is string => parseMediaFileName(fileName) !== null;

/** True when `fileName` is a media file of `kind` that belongs to rally `id`. */
export function isMediaOf(id: string, kind: MediaKind, fileName: unknown): fileName is string {
  const parsed = parseMediaFileName(fileName);
  return parsed !== null && parsed.owner === id && parsed.kind === kind;
}

export function stagedFileName(token: string, extension: AudioExtension | PhotoExtension): string {
  return `stage-${token}.${extension}`;
}

export function isStagedFileName(fileName: unknown): fileName is string {
  if (typeof fileName !== 'string') return false;
  const match = STAGED_NAME.exec(fileName);
  return !!match && (isAudioExtension(match[1]) || isPhotoExtension(match[1]));
}

/**
 * True for a `file:///` folder URI, ending in `/`, whose last folder is `name`. Anything that
 * could resolve elsewhere (`.`/`..` segments, empty segments, encoded dots or slashes) is refused.
 */
export function isPepDirectoryUri(uri: unknown, name: string): uri is string {
  if (typeof uri !== 'string' || !uri.startsWith('file:///') || !uri.endsWith(`/${name}/`)) return false;
  if (/%2e|%2f|%5c|\\/i.test(uri)) return false;
  const segments = uri.slice('file:///'.length, -1).split('/');
  return segments.length >= 2 && segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/** Documents is backed up, and the system may empty Caches and tmp, so saved media never goes there. */
const UNSUITABLE_MEDIA_PARENT = /\/(documents|library\/caches|tmp)\//i;

/** A folder saved media may live in: Puphii's own media folder, and nowhere backed up or purgeable. */
export const isSavedMediaUri = (uri: unknown): uri is string =>
  isPepDirectoryUri(uri, PEP_MEDIA_DIRECTORY) && !UNSUITABLE_MEDIA_PARENT.test(uri);
