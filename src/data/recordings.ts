/**
 * Deletion rules for on-device Pep Rally media. Recordings and their photos are files inside
 * one directory Puphii creates, listed by metadata in storage. Reset and delete must go
 * through `deleteRecordingFiles`: only files Puphii listed are removed, one at a time,
 * and never the directory or anything outside it.
 */

export type RecordingFile = { id: string; fileName: string };

const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}\.(m4a|aac|caf|wav|mp4|mp3|aiff|jpg|png|heic)$/;

export function isSafeRecordingFileName(fileName: unknown): fileName is string {
  return typeof fileName === 'string' && SAFE_FILE_NAME.test(fileName);
}

export type DeletionPlan = { uris: string[]; skipped: RecordingFile[] };

/** Files to delete for `recordings`. Entries whose name could point anywhere else are skipped, not guessed at. */
export function planRecordingDeletion(directoryUri: string, recordings: readonly RecordingFile[]): DeletionPlan {
  const skipped: RecordingFile[] = [];
  if (!/^file:\/\/\/.+\/$/.test(directoryUri) || directoryUri.includes('/../') || directoryUri.includes('/./')) {
    return { uris: [], skipped: [...recordings] };
  }
  const uris = new Set<string>();
  for (const recording of recordings) {
    if (isSafeRecordingFileName(recording.fileName)) uris.add(`${directoryUri}${recording.fileName}`);
    else skipped.push(recording);
  }
  return { uris: [...uris], skipped };
}

export type DeletionResult = { deleted: string[]; failed: string[]; skipped: RecordingFile[] };

export async function deleteRecordingFiles(
  directoryUri: string,
  recordings: readonly RecordingFile[],
  deleteFile: (uri: string) => Promise<void>,
): Promise<DeletionResult> {
  const plan = planRecordingDeletion(directoryUri, recordings);
  const deleted: string[] = [];
  const failed: string[] = [];
  for (const uri of plan.uris) {
    try {
      await deleteFile(uri);
      deleted.push(uri);
    } catch {
      failed.push(uri);
    }
  }
  return { deleted, failed, skipped: plan.skipped };
}
