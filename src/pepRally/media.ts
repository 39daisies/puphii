/**
 * The file operations Pep Rallies need, independent of any native API. Later phases connect
 * this to the device's file system; tests use an in-memory version. Puphii only ever passes
 * names it generated and URIs inside the two folders below.
 */
export interface PepMediaStore {
  /** Saved media: a `file:///` URI ending in `/pep-rallies/`, never inside Documents, Caches or tmp. */
  readonly libraryUri: string;
  /** Unsaved takes and imports: a `file:///` URI ending in `/pep-rally-staging/`. */
  readonly stagingUri: string;
  /** Names of the files directly inside the library folder. An absent folder is empty; an unreadable one rejects. */
  listLibrary(): Promise<string[]>;
  listStaging(): Promise<string[]>;
  /** Moves a staged file into the library folder. Must reject, and never overwrite, if `fileName` already exists there. */
  adopt(stagedName: string, fileName: string): Promise<void>;
  /** Deletes one file. Resolves if the file is already gone. */
  deleteFile(uri: string): Promise<void>;
  /**
   * Excludes one file in the library folder from device backups, then reads the setting back from
   * that file itself. Resolves `true` only when the read-back confirms it; the folder's own setting
   * doesn't count. Never moves or copies the file. Anything but `true`, including a rejection,
   * means the file is not confirmed and the recording is not finished.
   */
  excludeFromBackup(fileName: string): Promise<boolean>;
  /**
   * SHA-256 of the file's bytes, read from the file itself, as 64 lowercase hex characters.
   * Optional until it is provided natively; without it, a retry never keeps an earlier Pro
   * allowance. Anything else, including a rejection, means the file's identity is unknown.
   */
  fingerprint?(folder: 'staging' | 'library', fileName: string): Promise<string>;
}
