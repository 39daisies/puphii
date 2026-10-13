/**
 * Repairs the library after an interruption, by comparing it with the files actually in the
 * media folder. Saving that reached its file step is finished; saving that didn't is undone.
 * Missing files are reported, never used as a reason to drop a recording the person saved,
 * and files the library doesn't list are left alone.
 */

import { abandonCreate, abandonReplacement, completeCreate, completeReplacement } from './lifecycle';
import { filesOf, PepLibrary } from './model';

export type PepRecoveryReport = {
  /** Saves finished because their files had arrived. */
  completed: string[];
  /** Saves undone because their files never arrived. */
  abandoned: string[];
  /** Saved rallies whose audio isn't on this device, for example after restoring only part of a backup. */
  missingAudio: string[];
  missingPhoto: string[];
  /** Files in the media folder that no rally refers to. Never deleted by recovery. */
  unlisted: string[];
};

export const emptyRecoveryReport = (): PepRecoveryReport => ({ completed: [], abandoned: [], missingAudio: [], missingPhoto: [], unlisted: [] });

export function recoverLibrary(library: PepLibrary, filesInFolder: readonly string[], at: Date): { library: PepLibrary; report: PepRecoveryReport } {
  const present = new Set(filesInFolder);
  const report = emptyRecoveryReport();
  let next = library;

  for (const rally of library.rallies) {
    if (rally.status === 'pending') {
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
      const arrived = [rally.replacing.audio, rally.replacing.photo].some((media) => media && present.has(media.fileName));
      if (arrived) {
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
