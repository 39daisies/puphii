/**
 * Pure validation for files selected through iOS Files / exported Voice Memos.
 * Never trust a picker filename or media type as proof that bytes are decodable.
 * The native importer must also probe audio duration, format, and file size.
 */
import { AudioExtension, isAudioExtension } from './files';
import { MAX_DURATION_MS } from './model';

export const MAX_IMPORTED_AUDIO_BYTES = 25 * 1024 * 1024;
export type ImportAudioRejection =
  | 'invalidName'
  | 'unsupportedFormat'
  | 'invalidDuration'
  | 'tooLong'
  | 'invalidSize'
  | 'tooLarge';

export type AudioImportCandidate = {
  name: string;
  durationMs: number;
  byteSize: number;
};

export type AudioImportCheck =
  | { ok: true; extension: AudioExtension }
  | { ok: false; reason: ImportAudioRejection };

/**
 * Validate metadata after copying the document-picker result into app-owned staging.
 * The native integration MUST verify decodability independently; metadata can lie.
 * A longer file is rejected, not silently cropped.
 */
export function validateAudioImport(candidate: AudioImportCandidate): AudioImportCheck {
  if (typeof candidate.name !== 'string' || candidate.name.length === 0 || candidate.name.length > 255) {
    return { ok: false, reason: 'invalidName' };
  }
  const extension = candidate.name.match(/\.([a-z0-9]{3,4})$/i)?.[1]?.toLowerCase();
  if (!isAudioExtension(extension)) return { ok: false, reason: 'unsupportedFormat' };
  if (!Number.isFinite(candidate.durationMs) || candidate.durationMs <= 0) {
    return { ok: false, reason: 'invalidDuration' };
  }
  if (candidate.durationMs > MAX_DURATION_MS) return { ok: false, reason: 'tooLong' };
  if (!Number.isSafeInteger(candidate.byteSize) || candidate.byteSize <= 0) {
    return { ok: false, reason: 'invalidSize' };
  }
  if (candidate.byteSize > MAX_IMPORTED_AUDIO_BYTES) return { ok: false, reason: 'tooLarge' };
  return { ok: true, extension };
}

/** Untrusted picker names must never become app-owned media names. */
export function importStagingToken(nowMs: number, random: number): string {
  const time = Math.max(0, Math.floor(nowMs)).toString(36);
  const nonce = Math.floor(Math.min(Math.max(random, 0), 0.999999999) * 0x100000000).toString(36);
  return (time + nonce).slice(0, 40);
}
