/**
 * Repairs the library after an interruption, by comparing it with the files actually in the
 * media folder. Saving that reached its file step is finished, but only if every file it moved
 * is confirmed as excluded from backups; saving that didn't is undone. Missing files are
 * reported, never used as a reason to drop a recording the person saved, and files the library
 * doesn't list are left alone.
 */

import { abandonCreate, abandonReplacement, completeCreate, completeReplacement, discardCreate } from './lifecycle';
import { filesOf, PepLibrary } from './model';

export type PepRecoveryReport = {
  /** Saves finished because their files had arrived. */
  completed: string[];
  /** Saves undone because their files never arrived. */
  abandoned: string[];
  /** Saves undone, and their arrived files deleted, because those files couldn't be confirmed as excluded from backups. */
  unprotected: string[];
  /** Saved rallies whose audio isn't on this device, for example after restoring only part of a backup. */
  missingAudio: string[];
  missingPhoto: string[];
  /** Files in the media folder that no rally refers to. Never deleted by recovery, and never reported while a reset is unfinished. */
  unlisted: string[];
};

export const emptyRecoveryReport = (): PepRecoveryReport => ({
  completed: [],
  abandoned: [],
  unprotected: [],
  missingAudio: [],
  missingPhoto: [],
  unlisted: [],
});

/** Files an interrupted save moved into place, which must be confirmed as excluded from backups before it can finish. */
export function arrivedFiles(library: PepLibrary, filesInFolder: readonly string[]): string[] {
  const present = new Set(filesInFolder);
  const names: string[] = [];
  for (const rally of library.rallies) {
    if (rally.status === 'pending' && present.has(rally.audio.fileName)) names.push(rally.audio.fileName);
    if (rally.status !== 'deleting' && rally.replacing) {
      for (const media of [rally.replacing.audio, rally.replacing.photo]) if (media && present.has(media.fileName)) names.push(media.fileName);
    }
  }
  return names;
}

/** `unprotected`: arrived files that couldn't be confirmed as excluded from backups. */
export function recoverLibrary(
  library: PepLibrary,
  filesInFolder: readonly string[],
  at: Date,
  unprotected: ReadonlySet<string> = new Set(),
): { library: PepLibrary; report: PepRecoveryReport } {
  const present = new Set(filesInFolder);
  const report = emptyRecoveryReport();
  let next = library;

  for (const rally of library.rallies) {
    if (rally.status === 'pending') {
      if (present.has(rally.audio.fileName) && unprotected.has(rally.audio.fileName)) {
        next = discardCreate(next, rally.id, at);
        report.unprotected.push(rally.id);
        continue;
      }
      if (present.has(rally.audio.fileName)) {
        const result = completeCreate(next, rally.id, at);
        if (result.ok) next = result.library;
        report.completed.push(rally.id);
      } else {
        next = abandonCreate(next, rally.id, at);
        report.abandoned.push(rally.id);
        continue;
      }
    }
    if (rally.replacing && rally.status !== 'deleting') {
      const arrived = [rally.replacing.audio, rally.replacing.photo].filter((media) => media && present.has(media.fileName));
      if (arrived.some((media) => media && unprotected.has(media.fileName))) {
        next = abandonReplacement(next, rally.id, at);
        report.unprotected.push(rally.id);
      } else if (arrived.length) {
        const result = completeReplacement(next, rally.id, at, present);
        if (result.ok) next = result.library;
        report.completed.push(rally.id);
      } else {
        next = abandonReplacement(next, rally.id, at);
        report.abandoned.push(rally.id);
      }
    }
  }

  for (const rally of next.rallies) {
    if (rally.status !== 'ready') continue;
    if (!present.has(rally.audio.fileName)) report.missingAudio.push(rally.id);
    if (rally.photo && !present.has(rally.photo.fileName)) report.missingPhoto.push(rally.id);
  }

  const listed = new Set(library.rallies.flatMap(filesOf));
  report.unlisted = filesInFolder.filter((name) => !listed.has(name));
  return { library: next, report };
}
