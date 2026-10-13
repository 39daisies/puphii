import { createHash } from 'node:crypto';
import { loadFrom } from '../../src/data/persistence';
import { createPepRallyController } from '../../src/data/pepRallyController';
import { STORAGE_KEYS } from '../../src/data/storageKeys';
import { PepAccess } from '../../src/pepRally/access';
import { mediaFileName, stagedFileName } from '../../src/pepRally/files';
import { CreateDraft } from '../../src/pepRally/lifecycle';
import { PepMediaStore } from '../../src/pepRally/media';
import { PepLibrary, PepRally } from '../../src/pepRally/model';
import { MemoryStore } from '../plan/storeHarness';

const CONTAINER = 'file:///var/mobile/Containers/Data/Application/0A1B2C3D/';
export const LIBRARY_URI = `${CONTAINER}Library/Application%20Support/com.puphii.app/pep-rallies/`;
export const STAGING_URI = `${CONTAINER}Library/Caches/pep-rally-staging/`;
export const KEY = STORAGE_KEYS.pepRallies;

/** The device's file system for the two Pep Rally folders. Records every URI it is asked to touch. */
export class MemoryMedia implements PepMediaStore {
  libraryUri = LIBRARY_URI;
  stagingUri = STAGING_URI;
  readonly library = new Map<string, string>();
  readonly staging = new Map<string, string>();
  /** Files elsewhere on the device, which must never change. */
  readonly elsewhere = new Map<string, string>([[`${CONTAINER}Documents/notes.m4a`, 'other']]);
  readonly deleted: string[] = [];
  readonly outside: string[] = [];
  failDelete = new Set<string>();
  /** Deleted, but reported as a failure, as when an error arrives after the file is gone. */
  failAfterDelete = new Set<string>();
  failAdopt = false;
  failList = false;
  beforeAdopt: (() => Promise<void> | void) | null = null;
  afterAdopt: (() => Promise<void> | void) | null = null;
  /** The library folder's own backup setting. Never proof for the files inside it. */
  folderExcluded = true;
  /** Files whose read-back says they are not excluded from backups. */
  failExclusion = new Set<string>();
  /** When set, returned for every file instead of a real answer, or thrown if it is an Error. */
  exclusionAnswer: unknown = undefined;
  /** Every name the controller asked to exclude, in order. */
  readonly exclusionChecks: string[] = [];
  /** Files confirmed, by their own read-back, as excluded from backups. */
  readonly excluded = new Set<string>();
  /** When set, returned for every fingerprint instead of the real one, or thrown if it is an Error. */
  fingerprintAnswer: unknown = undefined;
  /** Every `folder/name` the controller asked to fingerprint, in order. */
  readonly fingerprintChecks: string[] = [];

  async listLibrary() {
    if (this.failList) throw new Error('unreadable');
    return [...this.library.keys()];
  }
  async listStaging() {
    return [...this.staging.keys()];
  }
  async adopt(stagedName: string, fileName: string) {
    await this.beforeAdopt?.();
    if (this.failAdopt) throw new Error('move failed');
    const content = this.staging.get(stagedName);
    if (content === undefined) throw new Error('nothing staged');
    if (this.library.has(fileName)) throw new Error('already exists');
    this.library.set(fileName, content);
    this.staging.delete(stagedName);
    await this.afterAdopt?.();
  }
  async deleteFile(uri: string) {
    const folder = uri.startsWith(LIBRARY_URI) ? this.library : uri.startsWith(STAGING_URI) ? this.staging : null;
    if (!folder) {
      this.outside.push(uri);
      throw new Error('outside Puphii folders');
    }
    const name = uri.slice((folder === this.library ? LIBRARY_URI : STAGING_URI).length);
    if (name.includes('/')) {
      this.outside.push(uri);
      throw new Error('nested path');
    }
    if (this.failDelete.has(name)) throw new Error('busy');
    this.deleted.push(uri);
    folder.delete(name);
    this.excluded.delete(name);
    if (this.failAfterDelete.delete(name)) throw new Error('late failure');
  }
  async excludeFromBackup(fileName: string) {
    this.exclusionChecks.push(fileName);
    if (this.exclusionAnswer instanceof Error) throw this.exclusionAnswer;
    if (this.exclusionAnswer !== undefined) return this.exclusionAnswer as boolean;
    if (!this.library.has(fileName) || this.failExclusion.has(fileName)) return false;
    this.excluded.add(fileName);
    return true;
  }
  async fingerprint(folder: 'staging' | 'library', fileName: string): Promise<string> {
    this.fingerprintChecks.push(`${folder}/${fileName}`);
    if (this.fingerprintAnswer instanceof Error) throw this.fingerprintAnswer;
    if (this.fingerprintAnswer !== undefined) return this.fingerprintAnswer as string;
    const content = (folder === 'library' ? this.library : this.staging).get(fileName);
    if (content === undefined) throw new Error('no such file');
    return createHash('sha256').update(content).digest('hex');
  }

  stage(token: string, extension: 'm4a' | 'jpg' = 'm4a', content = `staged ${token}`) {
    const name = stagedFileName(token, extension);
    this.staging.set(name, content);
    return name;
  }
  /** The files as they would be found after the app was killed at this moment. */
  clone() {
    const copy = new MemoryMedia();
    for (const [name, content] of this.library) copy.library.set(name, content);
    for (const [name, content] of this.staging) copy.staging.set(name, content);
    for (const name of this.excluded) copy.excluded.add(name);
    return copy;
  }
}

/** Device storage as it would be found after the app was killed at this moment. */
export const cloneStore = (store: MemoryStore) => new MemoryStore(Object.fromEntries(store.data));

export const DRAFT: CreateDraft = {
  title: 'Morning voice',
  source: 'microphone',
  voice: 'mine',
  consentConfirmed: false,
  audio: { extension: 'm4a', durationMs: 20_000, byteSize: 180_000 },
};

export const NOW = new Date('2026-10-13T08:00:00.000Z');

let counter = 0;
/** Ids in creation order, valid by the real pattern. */
export const sequentialIds = () => {
  let n = 0;
  counter += 1;
  return () => `pr-${(n++).toString(36)}${counter.toString(36)}-testtest`;
};

/**
 * The app as PuphiiStore will wire it: the shared loader, then the controller with its own
 * newest-wins queue writing one key. Launching again on the same storage is a restart.
 */
export function pepApp(store: MemoryStore, media: MemoryMedia | null = new MemoryMedia(), clock = { now: NOW }) {
  const errors: unknown[] = [];
  const io = { failWrites: false };
  /** Subscription status as the app would report it right now; tests change it mid-way. */
  const access = { current: 'free' as PepAccess };
  const controller = createPepRallyController({
    write: (library) => (io.failWrites ? Promise.reject(new Error('disk full')) : store.setItem(KEY, JSON.stringify(library))),
    onSaveError: (error) => errors.push(error),
    now: () => clock.now,
    newId: sequentialIds(),
    access: () => access.current,
  });
  return {
    controller,
    media,
    errors,
    io,
    clock,
    access,
    async launch({ recover = true } = {}) {
      const result = await loadFrom(store, { currency: 'USD', now: clock.now });
      controller.load(result.pepRallies, { canSave: result.canSave });
      if (media) controller.attachMedia(media);
      if (media && recover && result.canSave) await controller.recover();
      return result;
    },
    stored: (): PepLibrary | undefined => store.json(KEY),
  };
}

/** A saved rally, as storage would hold it. */
export function storedRally(id: string, extra: Partial<PepRally> = {}): PepRally {
  return {
    id,
    title: 'Saved voice',
    status: 'ready',
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-01T08:00:00.000Z',
    source: 'microphone',
    voice: 'mine',
    consentConfirmedAt: null,
    audio: { fileName: mediaFileName(id, 'audio', 1, 'm4a'), durationMs: 25_000, byteSize: 200_000 },
    photo: null,
    tags: [],
    favorite: false,
    lastPlayedAt: null,
    revision: 1,
    replacing: null,
    retiredFiles: [],
    ...extra,
  };
}

export const libraryOf = (...rallies: PepRally[]): PepLibrary => ({ version: 1, rallies, updatedAt: '2026-10-01T08:00:00.000Z' });
