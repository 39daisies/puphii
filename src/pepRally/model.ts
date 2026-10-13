/**
 * Voice Pep Rallies: the saved library of recordings. Only metadata is stored here; audio and
 * photos are files in Puphii's private media folder, named by `files.ts`. Nothing in this
 * record refers to puff logs or reduction plans, and nothing there refers to it.
 */

import { isRecord, withUnknownFields } from '../data/preserve';
import { isMediaOf, isPepRallyId, MAX_REVISION, parseMediaFileName } from './files';

export const PEP_LIBRARY_VERSION = 1;
export const DEFAULT_PEP_TITLE = 'Pep Rally';
export const TITLE_MAX_LENGTH = 40;
export const MAX_TAGS = 8;
/** Longest audio any tier can save. */
export const MAX_DURATION_MS = 60_000;
/** Recorders stop slightly after the requested length, so this much over a limit still fits it. */
export const DURATION_TOLERANCE_MS = 500;

/**
 * `pending`: saving has started but the audio may not be in place yet.
 * `deleting`: the person deleted it (or reset everything) and its files are being removed.
 */
export type PepRallyStatus = 'pending' | 'ready' | 'deleting';
const STATUSES: readonly PepRallyStatus[] = ['pending', 'ready', 'deleting'];

export type PepSource = 'microphone' | 'import';
const SOURCES: readonly PepSource[] = ['microphone', 'import'];

/** Whose voice it is. Someone else's needs their permission, confirmed before saving. */
export type PepVoice = 'mine' | 'someoneElse';
const VOICES: readonly PepVoice[] = ['mine', 'someoneElse'];

/** Moments a Pep Rally suits. Situations, not symptoms or outcomes. */
export const PEP_TAGS = ['craving', 'morning', 'afternoon', 'evening', 'work', 'social', 'tough', 'celebrate'] as const;
export type KnownPepTag = (typeof PEP_TAGS)[number];
/** Tags added by a newer version of Puphii are kept, so a tag is any tag-shaped string. */
export type PepTag = string;
const TAG = /^[a-z][a-zA-Z0-9]{0,31}$/;

export type PepAudio = { fileName: string; durationMs: number | null; byteSize: number | null };
export type PepPhoto = { fileName: string; width: number | null; height: number | null };

/** New media being swapped in. Its files may not exist yet; the current ones stay in use until it completes. */
export type PepReplacement = { audio: PepAudio | null; photo: PepPhoto | null };

export type PepRally = {
  id: string;
  title: string;
  status: PepRallyStatus;
  createdAt: string;
  updatedAt: string;
  source: PepSource;
  voice: PepVoice;
  /** When the person confirmed the speaker agreed. Required when `voice` is `someoneElse`. */
  consentConfirmedAt: string | null;
  audio: PepAudio;
  photo: PepPhoto | null;
  tags: PepTag[];
  favorite: boolean;
  /** Kept on this device only, for choosing which Pep Rally to suggest. */
  lastPlayedAt: string | null;
  /** Highest media revision ever used, so a new file never reuses an old name. */
  revision: number;
  replacing: PepReplacement | null;
  /** Files no longer in use that still have to be deleted. */
  retiredFiles: string[];
};

export type PepLibrary = {
  /** Higher than PEP_LIBRARY_VERSION when a newer Puphii wrote it; then it is kept but never changed. */
  version: number;
  rallies: PepRally[];
  updatedAt: string | null;
};

export const defaultPepLibrary = (): PepLibrary => ({ version: PEP_LIBRARY_VERSION, rallies: [], updatedAt: null });

const isInstant = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(new Date(value).getTime());
const isWhole = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const pick = <T>(value: unknown, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly unknown[]).includes(value) ? (value as T) : fallback;

/** The title as it will be saved, or null if it can't be one. */
export function normalizeTitle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const title = raw.trim();
  const length = [...title].length;
  return length >= 1 && length <= TITLE_MAX_LENGTH && !/[\u0000-\u001f\u007f]/.test(title) ? title : null;
}

/** Tags as they will be saved, or null if any of them can't be one. */
export function normalizeTags(raw: unknown): PepTag[] | null {
  if (!Array.isArray(raw)) return null;
  const tags = raw.filter((tag, index) => raw.indexOf(tag) === index);
  return tags.length <= MAX_TAGS && tags.every((tag) => typeof tag === 'string' && TAG.test(tag)) ? (tags as PepTag[]) : null;
}

export const isKnownPepTag = (tag: unknown): tag is KnownPepTag => (PEP_TAGS as readonly unknown[]).includes(tag);

function sanitizeAudio(id: string, raw: unknown): PepAudio | null {
  if (!isRecord(raw) || !isMediaOf(id, 'audio', raw.fileName)) return null;
  return withUnknownFields(raw, {
    fileName: raw.fileName,
    durationMs: isWhole(raw.durationMs, 1, MAX_DURATION_MS + DURATION_TOLERANCE_MS) ? raw.durationMs : null,
    byteSize: isWhole(raw.byteSize, 0, Number.MAX_SAFE_INTEGER) ? raw.byteSize : null,
  });
}

function sanitizePhoto(id: string, raw: unknown): PepPhoto | null {
  if (!isRecord(raw) || !isMediaOf(id, 'photo', raw.fileName)) return null;
  const side = (value: unknown) => (isWhole(value, 1, 100_000) ? value : null);
  return withUnknownFields(raw, { fileName: raw.fileName, width: side(raw.width), height: side(raw.height) });
}

/** Every file a rally refers to: in use, being swapped in, or waiting to be deleted. */
export function filesOf(rally: PepRally): string[] {
  const names = [rally.audio.fileName];
  if (rally.photo) names.push(rally.photo.fileName);
  if (rally.replacing?.audio) names.push(rally.replacing.audio.fileName);
  if (rally.replacing?.photo) names.push(rally.replacing.photo.fileName);
  names.push(...rally.retiredFiles);
  return names.filter((name, index) => names.indexOf(name) === index);
}

/**
 * Restores one stored rally. It is dropped only when its id or audio file name is unusable,
 * because then Puphii can't safely say which file is its own; anything else is repaired.
 */
function sanitizeRally(raw: unknown): PepRally | null {
  if (!isRecord(raw) || !isPepRallyId(raw.id)) return null;
  const id = raw.id;
  const audio = sanitizeAudio(id, raw.audio);
  if (!audio) return null;
  const photo = raw.photo == null ? null : sanitizePhoto(id, raw.photo);

  let replacing: PepReplacement | null = null;
  if (isRecord(raw.replacing)) {
    const next = withUnknownFields(raw.replacing, {
      audio: raw.replacing.audio == null ? null : sanitizeAudio(id, raw.replacing.audio),
      photo: raw.replacing.photo == null ? null : sanitizePhoto(id, raw.replacing.photo),
    });
    const clashes = next.audio?.fileName === audio.fileName || (!!photo && next.photo?.fileName === photo.fileName);
    replacing = (next.audio || next.photo) && !clashes ? next : null;
  }

  const inUse = new Set([audio.fileName, photo?.fileName, replacing?.audio?.fileName, replacing?.photo?.fileName]);
  const retiredFiles = Array.isArray(raw.retiredFiles)
    ? raw.retiredFiles.filter(
        (name, index, all): name is string =>
          (isMediaOf(id, 'audio', name) || isMediaOf(id, 'photo', name)) && !inUse.has(name) && all.indexOf(name) === index,
      )
    : [];

  const usedRevisions = [audio.fileName, photo?.fileName, replacing?.audio?.fileName, replacing?.photo?.fileName, ...retiredFiles].map(
    (name) => parseMediaFileName(name)?.revision ?? 1,
  );
  const highest = Math.max(...usedRevisions);
  const revision = isWhole(raw.revision, highest, MAX_REVISION) ? raw.revision : highest;

  const updatedAt = isInstant(raw.updatedAt) ? raw.updatedAt : null;
  const createdAt = isInstant(raw.createdAt) ? raw.createdAt : (updatedAt ?? new Date(0).toISOString());
  const voice = pick(raw.voice, VOICES, 'mine');

  return withUnknownFields(raw, {
    id,
    title: normalizeTitle(raw.title) ?? DEFAULT_PEP_TITLE,
    status: pick(raw.status, STATUSES, 'ready'),
    createdAt,
    updatedAt: updatedAt ?? createdAt,
    source: pick(raw.source, SOURCES, 'microphone'),
    voice,
    consentConfirmedAt: isInstant(raw.consentConfirmedAt) ? raw.consentConfirmedAt : null,
    audio,
    photo,
    tags: Array.isArray(raw.tags)
      ? raw.tags
          .filter((tag, index, all): tag is string => typeof tag === 'string' && TAG.test(tag) && all.indexOf(tag) === index)
          .slice(0, MAX_TAGS)
      : [],
    favorite: raw.favorite === true,
    lastPlayedAt: isInstant(raw.lastPlayedAt) ? raw.lastPlayedAt : null,
    revision,
    replacing,
    retiredFiles,
  });
}

/**
 * Restores the stored library. Invalid entries are repaired or dropped (the caller sets the
 * original aside); fields from other app versions are kept. Two entries can never share an id
 * or a file, so deleting one can never remove the other's media.
 */
export function sanitizePepLibrary(raw: unknown): PepLibrary {
  if (!isRecord(raw)) return defaultPepLibrary();
  const rallies: PepRally[] = [];
  const claimed = new Set<string>();
  for (const rally of Array.isArray(raw.rallies) ? raw.rallies.map(sanitizeRally) : []) {
    if (!rally || rallies.some((other) => other.id === rally.id)) continue;
    const files = filesOf(rally);
    if (files.some((name) => claimed.has(name))) continue;
    files.forEach((name) => claimed.add(name));
    rallies.push(rally);
  }
  return withUnknownFields(raw, {
    version: isWhole(raw.version, 1, Number.MAX_SAFE_INTEGER) ? raw.version : PEP_LIBRARY_VERSION,
    rallies,
    updatedAt: isInstant(raw.updatedAt) ? raw.updatedAt : null,
  });
}

/** Written by a newer Puphii: readable, but saving it here could drop what that version added. */
export const isNewerLibrary = (library: PepLibrary): boolean => library.version > PEP_LIBRARY_VERSION;

/** Rallies the person can see and play. */
export const visibleRallies = (library: PepLibrary): PepRally[] => library.rallies.filter((rally) => rally.status === 'ready');

export const findRally = (library: PepLibrary, id: string): PepRally | undefined => library.rallies.find((rally) => rally.id === id);
