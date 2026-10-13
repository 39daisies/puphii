import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { PepResetResult } from '../src/data/pepRallyController';
import { CORRUPT_DATA_MESSAGE } from '../src/data/persistence';
import { STORAGE_KEYS } from '../src/data/storageKeys';
import { defaultPepLibrary, PepLibrary, visibleRallies } from '../src/pepRally/model';
import { app as trackingApp, EXISTING, MemoryStore, REDUCE } from './plan/storeHarness';
import { cloneStore, DRAFT, KEY, libraryOf, LIBRARY_URI, MemoryMedia, NOW, pepApp, STAGING_URI, storedRally } from './pepRally/fakes';

const A = 'pr-mgabc123-k3j9x0qa';
const B = 'pr-mgabc456-p0p0p0p0';
const RESET_OK: PepResetResult = { ok: true, reason: null, failed: [], remaining: [] };
const NEW_AUDIO = { extension: 'm4a', durationMs: 12_000, byteSize: 1 } as const;

/** Launches, saves one rally from a staged take, and returns everything. */
async function withOneSaved(store = new MemoryStore(), media = new MemoryMedia()) {
  const app = pepApp(store, media);
  await app.launch();
  const result = await app.controller.create(DRAFT, media.stage('take1'));
  assert.ok(result.ok);
  return { app, store, media, id: result.rally!.id };
}

/** Restarts on storage and files exactly as they were at the moment of a crash. */
async function relaunch(store: MemoryStore, media: MemoryMedia) {
  const app = pepApp(cloneStore(store), media.clone());
  await app.launch();
  return app;
}

describe('Pep Rally persistence', () => {
  test('a fresh install and an existing install gain an empty library without writing anything', async () => {
    for (const initial of [{}, EXISTING]) {
      const store = new MemoryStore(initial);
      const before = new Map(store.data);
      const app = pepApp(store);
      const result = await app.launch();
      assert.deepEqual(result.pepRallies, defaultPepLibrary());
      assert.equal(store.data.has(KEY), false);
      for (const [key, value] of before) assert.equal(store.data.get(key), value, `${key} is untouched`);
    }
  });

  test('a saved rally survives a restart exactly, with its file in the private folder', async () => {
    const { app, store, media, id } = await withOneSaved();
    assert.deepEqual([...media.library.keys()], [`${id}-a1.m4a`]);
    assert.equal(media.staging.size, 0);
    const rally = app.controller.current().rallies[0];
    assert.equal(rally.status, 'ready');
    assert.equal(rally.title, 'Morning voice');
    const next = await relaunch(store, media);
    assert.deepEqual(next.controller.current(), app.controller.current());
    assert.deepEqual(next.controller.health().missingAudio, []);
  });

  test('rapid changes are written one at a time and the newest always wins', async () => {
    const { app, store, id } = await withOneSaved();
    store.writeDelay = () => 5;
    const before = store.writes.length;
    for (const title of ['One', 'Two', 'Three', 'Four']) assert.ok(app.controller.rename(id, title).ok);
    app.controller.markPlayed(id);
    await app.controller.flush();
    assert.equal(app.stored()!.rallies[0].title, 'Four');
    assert.equal(app.stored()!.rallies[0].lastPlayedAt, NOW.toISOString());
    assert.equal(store.writes.length - before, 2, 'one write in flight, then only the newest snapshot');
  });

  test('fields written by other versions survive a save', async () => {
    const stored = { ...libraryOf({ ...storedRally(A), mood: 'calm' } as never), sortOrder: 'newest' };
    const media = new MemoryMedia();
    media.library.set(`${A}-a1.m4a`, 'audio');
    const store = new MemoryStore({ [KEY]: stored });
    const app = pepApp(store, media);
    await app.launch();
    assert.ok(app.controller.rename(A, 'Renamed').ok);
    await app.controller.flush();
    const saved = store.json(KEY);
    assert.equal(saved.sortOrder, 'newest');
    assert.equal(saved.rallies[0].mood, 'calm');
    assert.equal(saved.rallies[0].title, 'Renamed');
  });

  test('a library from a newer Puphii is shown but never rewritten', async () => {
    const store = new MemoryStore({ [KEY]: { ...libraryOf(storedRally(A)), version: 2 } });
    const media = new MemoryMedia();
    media.library.set(`${A}-a1.m4a`, 'audio');
    const before = store.data.get(KEY);
    const app = pepApp(store, media);
    await app.launch();
    assert.equal(visibleRallies(app.controller.current()).length, 1);
    app.access.current = 'pro';
    assert.deepEqual(app.controller.rename(A, 'x'), { ok: false, error: 'readOnly' });
    assert.deepEqual(await app.controller.create(DRAFT, media.stage('t')), { ok: false, error: 'readOnly' });
    assert.equal(store.data.get(KEY), before);
  });

  test('if storage cannot be read, nothing is written and no file is touched', async () => {
    const store = new MemoryStore({ [KEY]: libraryOf(storedRally(A)) });
    store.failReads = true;
    const media = new MemoryMedia();
    media.library.set(`${A}-a1.m4a`, 'audio');
    const app = pepApp(store, media);
    const result = await app.launch();
    assert.equal(result.canSave, false);
    store.failReads = false;
    assert.deepEqual(await app.controller.delete(A), { ok: false, error: 'storageUnavailable' });
    assert.deepEqual(await app.controller.reset(), { ok: false, reason: 'storageUnavailable', failed: [], remaining: [] });
    assert.equal(store.writes.length, 0);
    assert.equal(media.deleted.length, 0);
  });

  test('a failed metadata write stops a save before its file is moved', async () => {
    const store = new MemoryStore();
    const media = new MemoryMedia();
    const app = pepApp(store, media);
    await app.launch();
    app.io.failWrites = true;
    const staged = media.stage('take1');
    assert.deepEqual(await app.controller.create(DRAFT, staged), { ok: false, error: 'saveFailed' });
    assert.equal(media.library.size, 0);
    assert.ok(media.staging.has(staged), 'the take is still there to try again');
    assert.deepEqual(app.controller.current().rallies, []);
    assert.ok(app.errors.length > 0);
  });

  test('a save never overwrites a file already in the folder', async () => {
    const store = new MemoryStore();
    const media = new MemoryMedia();
    const app = pepApp(store, media);
    await app.launch();
    media.beforeAdopt = () => {
      for (const name of app.controller.current().rallies.map((rally) => rally.audio.fileName)) media.library.set(name, 'older file');
    };
    assert.deepEqual(await app.controller.create(DRAFT, media.stage('take1')), { ok: false, error: 'mediaFailed' });
    assert.deepEqual([...media.library.values()], ['older file']);
    assert.deepEqual(app.controller.current().rallies, [], 'the save is undone');
  });
});

describe('Pep Rally crash recovery', () => {
  test('killed before the new rally was written: nothing saved, the unsaved take is cleared', async () => {
    const store = new MemoryStore();
    const media = new MemoryMedia();
    const app = pepApp(store, media);
    await app.launch();
    let crash = null as { store: MemoryStore; media: MemoryMedia } | null;
    store.writeDelay = (key) => {
      if (key === KEY && !crash) crash = { store: cloneStore(store), media: media.clone() };
      return 0;
    };
    await app.controller.create(DRAFT, media.stage('take1'));
    const after = await relaunch(crash!.store, crash!.media);
    assert.deepEqual(after.controller.current().rallies, []);
    assert.equal(crash!.store.data.has(KEY), false);
    assert.equal(after.media!.staging.size, 0);
  });

  test('killed after "pending" was written but before the file moved: the save is undone', async () => {
    const store = new MemoryStore();
    const media = new MemoryMedia();
    const app = pepApp(store, media);
    await app.launch();
    let crash = null as [MemoryStore, MemoryMedia] | null;
    media.beforeAdopt = () => {
      crash = [cloneStore(store), media.clone()];
    };
    await app.controller.create(DRAFT, media.stage('take1'));
    assert.equal(crash![0].json(KEY).rallies[0].status, 'pending');
    const after = await relaunch(...crash!);
    assert.deepEqual(after.controller.current().rallies, []);
    assert.deepEqual(after.controller.health().abandoned.length, 1);
    assert.equal(after.media!.staging.size, 0);
    assert.equal(after.media!.library.size, 0);
  });

  test('killed after the file moved but before "ready" was written: the save is finished', async () => {
    const store = new MemoryStore();
    const media = new MemoryMedia();
    const app = pepApp(store, media);
    await app.launch();
    let crash = null as [MemoryStore, MemoryMedia] | null;
    media.afterAdopt = () => {
      crash = [cloneStore(store), media.clone()];
    };
    await app.controller.create(DRAFT, media.stage('take1'));
    const after = await relaunch(...crash!);
    const [rally] = after.controller.current().rallies;
    assert.equal(rally.status, 'ready');
    assert.ok(after.media!.library.has(rally.audio.fileName));
    assert.equal(after.stored()!.rallies[0].status, 'ready');
  });

  test('an interrupted replacement keeps the old audio until the new file is in place', async () => {
    const { app, store, media, id } = await withOneSaved(undefined, undefined);
    let beforeMove = null as [MemoryStore, MemoryMedia] | null;
    let afterMove = null as [MemoryStore, MemoryMedia] | null;
    media.beforeAdopt = () => {
      beforeMove = [cloneStore(store), media.clone()];
    };
    media.afterAdopt = () => {
      afterMove = [cloneStore(store), media.clone()];
    };
    const replaced = await app.controller.replace(id, { audio: { extension: 'm4a', durationMs: 12_000, byteSize: 1 } }, { audio: media.stage('take2') });
    assert.ok(replaced.ok);
    assert.deepEqual([...media.library.keys()], [`${id}-a2.m4a`], 'the old file is deleted once the new one is saved');

    const undone = await relaunch(...beforeMove!);
    assert.equal(undone.controller.current().rallies[0].audio.fileName, `${id}-a1.m4a`);
    assert.deepEqual([...undone.media!.library.keys()], [`${id}-a1.m4a`]);

    const finished = await relaunch(...afterMove!);
    assert.equal(finished.controller.current().rallies[0].audio.fileName, `${id}-a2.m4a`);
    assert.deepEqual([...finished.media!.library.keys()], [`${id}-a2.m4a`]);
    assert.deepEqual(finished.controller.current().rallies[0].retiredFiles, []);
  });

  test('killed after a replacement was saved but before the old file was deleted: it is deleted at launch', async () => {
    const store = new MemoryStore({
      [KEY]: libraryOf(storedRally(A, { audio: { fileName: `${A}-a2.m4a`, durationMs: 9000, byteSize: null }, revision: 2, retiredFiles: [`${A}-a1.m4a`] })),
    });
    const media = new MemoryMedia();
    media.library.set(`${A}-a1.m4a`, 'old').set(`${A}-a2.m4a`, 'new');
    const app = await relaunch(store, media);
    assert.deepEqual([...app.media!.library.keys()], [`${A}-a2.m4a`]);
    assert.deepEqual(app.controller.current().rallies[0].retiredFiles, []);
  });

  test('an interrupted deletion is finished at launch, whichever step it reached', async () => {
    const deleting = storedRally(A, { status: 'deleting', photo: { fileName: `${A}-p1.jpg`, width: null, height: null } });
    for (const files of [[`${A}-a1.m4a`, `${A}-p1.jpg`], [`${A}-p1.jpg`], []]) {
      const store = new MemoryStore({ [KEY]: libraryOf(deleting, storedRally(B)) });
      const media = new MemoryMedia();
      for (const name of [...files, `${B}-a1.m4a`]) media.library.set(name, 'x');
      const app = await relaunch(store, media);
      assert.deepEqual(app.controller.current().rallies.map((rally) => rally.id), [B], files.join());
      assert.deepEqual([...app.media!.library.keys()], [`${B}-a1.m4a`]);
      assert.deepEqual(app.stored()!.rallies.map((rally) => rally.id), [B]);
    }
  });
});

describe('Pep Rally missing files and corrupted metadata', () => {
  test('a recording whose file is missing is kept, reported, and can still be deleted', async () => {
    const store = new MemoryStore({ [KEY]: libraryOf(storedRally(A, { photo: { fileName: `${A}-p1.jpg`, width: null, height: null } }), storedRally(B)) });
    const media = new MemoryMedia();
    media.library.set(`${B}-a1.m4a`, 'x');
    const app = pepApp(store, media);
    await app.launch();
    assert.deepEqual(app.controller.health().missingAudio, [A]);
    assert.deepEqual(app.controller.health().missingPhoto, [A]);
    assert.equal(visibleRallies(app.controller.current()).length, 2);
    assert.ok((await app.controller.delete(A)).ok);
    assert.deepEqual(app.stored()!.rallies.map((rally) => rally.id), [B]);
    assert.ok(media.library.has(`${B}-a1.m4a`));
  });

  test('unreadable metadata is set aside, other data is unaffected, and media files are left alone', async () => {
    const store = new MemoryStore({ ...EXISTING, [KEY]: '{"rallies": [' });
    const media = new MemoryMedia();
    media.library.set(`${A}-a1.m4a`, 'still here');
    const app = pepApp(store, media);
    const result = await app.launch();
    assert.equal(result.error, CORRUPT_DATA_MESSAGE);
    assert.deepEqual(result.pepRallies, defaultPepLibrary());
    assert.equal(result.logs.length, 18);
    assert.equal(store.keysStartingWith(`${KEY}-corrupt-`).length, 1);
    assert.equal(store.data.get(STORAGE_KEYS.logs), JSON.stringify(EXISTING[STORAGE_KEYS.logs]));
    assert.deepEqual(app.controller.health().unlisted, [`${A}-a1.m4a`]);
    assert.equal(media.library.get(`${A}-a1.m4a`), 'still here');
    assert.equal(media.deleted.length, 0);
  });

  test('partly invalid metadata keeps the valid recordings and sets the original aside', async () => {
    const raw = libraryOf(storedRally(A), { ...storedRally(B), audio: { fileName: '../../Documents/notes.m4a', durationMs: 1, byteSize: 1 } });
    const store = new MemoryStore({ [KEY]: raw });
    const media = new MemoryMedia();
    media.library.set(`${A}-a1.m4a`, 'x');
    const app = pepApp(store, media);
    const result = await app.launch();
    assert.deepEqual(result.pepRallies.rallies.map((rally) => rally.id), [A]);
    const [copy] = store.keysStartingWith(`${KEY}-invalid-`);
    assert.deepEqual(store.json(copy), raw);
    assert.equal(media.outside.length, 0);
    assert.equal(media.elsewhere.get('file:///var/mobile/Containers/Data/Application/0A1B2C3D/Documents/notes.m4a'), 'other');
  });
});

describe('Pep Rally deletion and reset', () => {
  test('deleting removes only that rally’s files, one by one, inside the private folder', async () => {
    const store = new MemoryStore({
      [KEY]: libraryOf(
        storedRally(A, { photo: { fileName: `${A}-p2.jpg`, width: null, height: null }, retiredFiles: [`${A}-a2.m4a`], revision: 2 }),
        storedRally(B),
      ),
    });
    const media = new MemoryMedia();
    for (const name of [`${A}-a1.m4a`, `${A}-p2.jpg`, `${A}-a2.m4a`, `${B}-a1.m4a`, 'readme.txt']) media.library.set(name, 'x');
    const app = pepApp(store, media);
    await app.launch({ recover: false });
    assert.ok((await app.controller.delete(A)).ok);
    assert.deepEqual(media.deleted.sort(), [`${LIBRARY_URI}${A}-a1.m4a`, `${LIBRARY_URI}${A}-a2.m4a`, `${LIBRARY_URI}${A}-p2.jpg`]);
    assert.deepEqual([...media.library.keys()].sort(), [`${B}-a1.m4a`, 'readme.txt']);
    assert.deepEqual(app.stored()!.rallies.map((rally) => rally.id), [B]);
    assert.equal(media.outside.length, 0);
  });

  test('a file that cannot be deleted keeps the rally hidden, and deletion is retried at launch', async () => {
    const { app, store, media, id } = await withOneSaved();
    media.failDelete.add(`${id}-a1.m4a`);
    assert.ok((await app.controller.delete(id)).ok);
    assert.equal(visibleRallies(app.controller.current()).length, 0);
    assert.equal(app.stored()!.rallies[0].status, 'deleting');
    const retried = await relaunch(store, media);
    retried.media!.failDelete.clear();
    assert.ok((await retried.controller.recover()).ok);
    assert.deepEqual(retried.controller.current().rallies, []);
    assert.equal(retried.media!.library.size, 0);
  });

  test('a delete that cannot be written is undone, so nothing disappears without being saved', async () => {
    const { app, id } = await withOneSaved();
    app.io.failWrites = true;
    assert.deepEqual(await app.controller.delete(id), { ok: false, error: 'saveFailed' });
    assert.equal(visibleRallies(app.controller.current()).length, 1);
    assert.ok(app.media!.library.has(`${id}-a1.m4a`));
  });

  test('Reset everything deletes every Pep Rally file, photo and unsaved take, including unlisted ones Puphii named, and nothing else', async () => {
    const store = new MemoryStore({
      ...EXISTING,
      [KEY]: libraryOf(storedRally(A, { photo: { fileName: `${A}-p1.jpg`, width: null, height: null } }), storedRally(B, { status: 'pending' })),
    });
    const media = new MemoryMedia();
    for (const name of [`${A}-a1.m4a`, `${A}-p1.jpg`, `${B}-a1.m4a`, 'pr-zz-zzzzzzzz-p1.jpg', 'readme.txt']) media.library.set(name, 'x');
    media.staging.set('stage-old.m4a', 'x').set('stage-pic.jpg', 'x').set('keep-me.m4a', 'x');
    const app = pepApp(store, media);
    await app.launch({ recover: false });
    const others = [...store.data].filter(([key]) => key !== KEY);
    const result = await app.controller.reset();
    assert.deepEqual(result, RESET_OK);
    assert.deepEqual(app.controller.current().rallies, []);
    assert.deepEqual(app.stored()!.rallies, []);
    assert.deepEqual([...media.library.keys()], ['readme.txt']);
    assert.deepEqual([...media.staging.keys()], ['keep-me.m4a']);
    assert.equal(media.outside.length, 0);
    assert.equal(media.elsewhere.size, 1);
    for (const [key, value] of others) assert.equal(store.data.get(key), value, `${key} is untouched`);
  });

  test('recovery never deletes files the library does not list', async () => {
    const store = new MemoryStore({ [KEY]: libraryOf() });
    const media = new MemoryMedia();
    media.library.set('pr-zz-zzzzzzzz-a1.m4a', 'unlisted').set('readme.txt', 'x');
    const app = pepApp(store, media);
    await app.launch();
    assert.deepEqual([...media.library.keys()], ['pr-zz-zzzzzzzz-a1.m4a', 'readme.txt']);
    assert.equal(media.deleted.length, 0);
  });

  test('only the staging folder’s own take names are cleared at launch', async () => {
    const media = new MemoryMedia();
    media.staging.set('stage-old.m4a', 'x').set('keep-me.m4a', 'x');
    const app = pepApp(new MemoryStore(), media);
    await app.launch();
    assert.deepEqual([...media.staging.keys()], ['keep-me.m4a']);
    assert.deepEqual(media.deleted, [`${STAGING_URI}stage-old.m4a`]);
  });

  test("a media store pointing anywhere but Puphii's folders, or saving into Documents, Caches or tmp, is refused, and nothing is touched", async () => {
    const store = new MemoryStore({ [KEY]: libraryOf(storedRally(A, { status: 'deleting' })) });
    const container = 'file:///var/mobile/Containers/Data/Application/0A1B2C3D/';
    for (const libraryUri of [
      `${container}Documents/`,
      'file:///var/mobile/../pep-rallies/',
      'file:///pep-rallies/',
      `${container}Documents/pep-rallies/`,
      `${container}Library/Caches/pep-rallies/`,
      `${container}tmp/pep-rallies/`,
    ]) {
      const media = new MemoryMedia();
      media.libraryUri = libraryUri;
      const app = pepApp(cloneStore(store), null);
      await app.launch();
      assert.equal(app.controller.attachMedia(media), false, libraryUri);
      app.access.current = 'pro';
      assert.deepEqual(await app.controller.recover(), { ok: false, error: 'noMediaStore' });
      assert.deepEqual(await app.controller.create(DRAFT, media.stage('t')), { ok: false, error: 'noMediaStore' });
      await app.controller.reset();
      assert.equal(media.deleted.length + media.outside.length, 0);
    }
  });
});

describe('Reset everything coordinates with work in progress', () => {
  test('a reset racing with an active save waits for it, then leaves no rally, file or take', async () => {
    const store = new MemoryStore();
    const media = new MemoryMedia();
    const app = pepApp(store, media);
    await app.launch();
    app.access.current = 'pro';
    const order: string[] = [];
    let resetting = null as Promise<PepResetResult> | null;
    media.beforeAdopt = async () => {
      media.beforeAdopt = null;
      resetting = app.controller.reset().then((result) => {
        order.push('reset');
        return result;
      });
      await app.controller.flush();
      assert.equal(app.stored()!.rallies[0].status, 'deleting', 'the reset is saved before the file moves');
      assert.deepEqual(await app.controller.create(DRAFT, media.stage('take2')), { ok: false, error: 'busy' });
    };
    await app.controller.create(DRAFT, media.stage('take1')).then(() => order.push('save'));
    assert.deepEqual(await resetting, RESET_OK);
    assert.deepEqual(order, ['save', 'reset'], 'the reset finishes only after the save it raced with');
    assert.deepEqual(app.controller.current().rallies, []);
    assert.deepEqual(app.stored()!.rallies, []);
    assert.equal(media.library.size, 0);
    assert.equal(media.staging.size, 0);
  });

  test('a reset during a replacement in progress removes the old and the new files', async () => {
    const { app, media, id } = await withOneSaved();
    let resetting = null as Promise<PepResetResult> | null;
    media.afterAdopt = async () => {
      media.afterAdopt = null;
      resetting = app.controller.reset();
      await app.controller.flush();
    };
    await app.controller.replace(id, { audio: NEW_AUDIO }, { audio: media.stage('take2') });
    assert.deepEqual(await resetting, RESET_OK);
    assert.deepEqual(app.controller.current().rallies, []);
    assert.deepEqual(app.stored()!.rallies, []);
    assert.equal(media.library.size, 0);
    assert.equal(media.staging.size, 0);
  });

  test('a reset after a replacement was interrupted removes current, arriving and retired files', async () => {
    const replacing = storedRally(A, {
      title: 'Before the interview',
      revision: 3,
      replacing: { audio: { fileName: `${A}-a3.m4a`, durationMs: 9000, byteSize: null }, photo: { fileName: `${A}-p3.jpg`, width: 1, height: 1 } },
      retiredFiles: [`${A}-a2.m4a`],
    });
    const store = new MemoryStore({ [KEY]: libraryOf(replacing) });
    const media = new MemoryMedia();
    for (const name of [`${A}-a1.m4a`, `${A}-a2.m4a`, `${A}-a3.m4a`]) media.library.set(name, 'x');
    const app = pepApp(store, media);
    await app.launch({ recover: false });
    assert.deepEqual(await app.controller.reset(), RESET_OK);
    assert.equal(media.library.size, 0);
    assert.deepEqual(app.stored()!.rallies, []);
    assert.ok(!store.data.get(KEY)!.includes('Before the interview'));
    assert.equal(media.outside.length, 0);
  });

  test('a reset during recovery waits for it, and recovery cannot start during a reset', async () => {
    const store = new MemoryStore({ [KEY]: libraryOf(storedRally(A, { status: 'pending' }), storedRally(B)) });
    const media = new MemoryMedia();
    media.library.set(`${A}-a1.m4a`, 'x').set(`${B}-a1.m4a`, 'x');
    media.staging.set('stage-old.m4a', 'x');
    const app = pepApp(store, media);
    await app.launch({ recover: false });
    const list = media.listLibrary.bind(media);
    let resetting = null as Promise<PepResetResult> | null;
    media.listLibrary = async () => {
      const files = await list();
      if (!resetting) {
        resetting = app.controller.reset();
        await app.controller.flush();
        assert.deepEqual(await app.controller.recover(), { ok: false, error: 'busy' });
      }
      return files;
    };
    const recovered = await app.controller.recover();
    assert.ok(recovered.ok);
    assert.deepEqual(await resetting, RESET_OK);
    assert.deepEqual(app.controller.current().rallies, [], 'recovery never brings back a rally the reset removed');
    assert.deepEqual(app.stored()!.rallies, []);
    assert.equal(media.library.size, 0);
    assert.equal(media.staging.size, 0);
  });

  test('while a reset runs, new takes and saves are refused; afterwards they work again', async () => {
    const { app, store, media } = await withOneSaved();
    store.writeDelay = () => 5;
    const resetting = app.controller.reset();
    app.access.current = 'pro';
    assert.deepEqual(app.controller.openTake(media.stage('during')), { ok: false, error: 'busy' });
    assert.deepEqual(await app.controller.create(DRAFT, media.stage('during2')), { ok: false, error: 'busy' });
    app.access.current = 'free';
    assert.deepEqual(await resetting, RESET_OK);
    assert.equal(media.staging.size, 0, 'takes staged during the reset are deleted with the rest');
    const after = media.stage('after');
    assert.deepEqual(app.controller.openTake(after), { ok: true, maxDurationMs: 30_000 });
    assert.ok((await app.controller.create(DRAFT, after)).ok);
    await app.controller.releaseTake(after);
    assert.equal(visibleRallies(app.controller.current()).length, 1);
  });

  test('a take still being recorded is not reported as deleted, cannot be saved, and is deleted when released', async () => {
    const { app, media } = await withOneSaved();
    media.stage('old1');
    media.stage('old2', 'jpg');
    media.staging.set('keep-me.m4a', 'not a Puphii take');
    const live = media.stage('live');
    app.access.current = 'pro';
    assert.ok(app.controller.openTake(live).ok);
    assert.deepEqual(await app.controller.reset(), { ok: false, reason: 'filesRemain', failed: [], remaining: [live] });
    assert.deepEqual([...media.staging.keys()].sort(), ['keep-me.m4a', live]);
    assert.equal(media.library.size, 0);
    assert.deepEqual(await app.controller.create(DRAFT, live), { ok: false, error: 'discarded' });
    assert.ok(!media.staging.has(live), 'a take from before the reset is deleted, not saved');
    await app.controller.releaseTake(live);
    assert.deepEqual(await app.controller.reset(), RESET_OK);
    assert.deepEqual([...media.staging.keys()], ['keep-me.m4a']);
    assert.deepEqual(app.controller.current().rallies, []);
    assert.equal(media.outside.length, 0);
  });

  test('a released take from before a reset is deleted even if it was never saved', async () => {
    const { app, media } = await withOneSaved();
    const live = media.stage('live');
    app.access.current = 'pro';
    assert.ok(app.controller.openTake(live).ok);
    await app.controller.reset();
    assert.ok(media.staging.has(live));
    await app.controller.releaseTake(live);
    assert.equal(media.staging.size, 0);
  });

  test('a file that cannot be deleted means no full success, but every detail is already erased', async () => {
    const { app, store, media, id } = await withOneSaved();
    assert.ok(app.controller.rename(id, 'Call from Dad').ok);
    media.failDelete.add(`${id}-a1.m4a`);
    const result = await app.controller.reset();
    assert.deepEqual(result, { ok: false, reason: 'filesRemain', failed: [`${LIBRARY_URI}${id}-a1.m4a`], remaining: [`${id}-a1.m4a`] });
    assert.equal(visibleRallies(app.controller.current()).length, 0);
    const [stored] = app.stored()!.rallies;
    assert.equal(stored.status, 'deleting');
    assert.equal(stored.title, 'Pep Rally');
    assert.ok(!store.data.get(KEY)!.includes('Call from Dad'));
    const next = await relaunch(store, media);
    assert.deepEqual(next.controller.current().rallies, [], 'finished at the next launch');
    assert.equal(next.media!.library.size, 0);
  });

  test('without device storage connected, a reset erases the details but does not claim the files are gone', async () => {
    const store = new MemoryStore({ [KEY]: libraryOf(storedRally(A, { title: 'Private words' })) });
    const app = pepApp(store, null);
    await app.launch();
    assert.deepEqual(await app.controller.reset(), { ok: false, reason: 'noMediaStore', failed: [], remaining: [] });
    assert.ok(!store.data.get(KEY)!.includes('Private words'));
    assert.equal(store.json(KEY).rallies[0].status, 'deleting');
  });

  test('a delete that cannot be saved is not undone over a reset that erased the rally meanwhile', async () => {
    const { app, id } = await withOneSaved();
    app.io.failWrites = true;
    const deleting = app.controller.delete(id);
    const resetting = app.controller.reset();
    assert.deepEqual(await deleting, { ok: false, error: 'saveFailed' });
    assert.equal((await resetting).reason, 'saveFailed');
    assert.equal(visibleRallies(app.controller.current()).length, 0, 'an erased recording never reappears empty');
    assert.equal(app.controller.current().rallies[0].status, 'deleting');
  });

  test('a reset that cannot be saved reports it and touches no file', async () => {
    const { app, media, id } = await withOneSaved();
    app.io.failWrites = true;
    assert.deepEqual(await app.controller.reset(), { ok: false, reason: 'saveFailed', failed: [], remaining: [] });
    assert.ok(media.library.has(`${id}-a1.m4a`));
  });
});

describe('File operations that fail after the file may have moved', () => {
  test('a save whose move finished before reporting an error is kept, not orphaned', async () => {
    const store = new MemoryStore();
    const media = new MemoryMedia();
    const app = pepApp(store, media);
    await app.launch();
    media.afterAdopt = () => {
      throw new Error('reported after the move');
    };
    const result = await app.controller.create(DRAFT, media.stage('take1'));
    assert.ok(result.ok);
    assert.equal(result.rally!.status, 'ready');
    assert.deepEqual([...media.library.keys()], [result.rally!.audio.fileName]);
    assert.equal(app.stored()!.rallies[0].status, 'ready');
    const next = await relaunch(store, media);
    assert.deepEqual(next.controller.health().unlisted, []);
    assert.equal(visibleRallies(next.controller.current()).length, 1);
  });

  test('if the folder cannot be checked after a failed move, the save is left for recovery to decide', async () => {
    const store = new MemoryStore();
    const media = new MemoryMedia();
    const app = pepApp(store, media);
    await app.launch();
    media.afterAdopt = () => {
      media.failList = true;
      throw new Error('reported after the move');
    };
    assert.deepEqual(await app.controller.create(DRAFT, media.stage('take1')), { ok: false, error: 'mediaFailed' });
    assert.equal(app.stored()!.rallies[0].status, 'pending');
    assert.equal(visibleRallies(app.controller.current()).length, 0);
    const next = await relaunch(store, media);
    assert.equal(next.controller.current().rallies[0].status, 'ready', 'the file had arrived, so the save is finished');
    assert.deepEqual(next.controller.health().unlisted, []);
  });

  test('a move that failed before anything moved undoes the save and keeps the take', async () => {
    const store = new MemoryStore();
    const media = new MemoryMedia();
    const app = pepApp(store, media);
    await app.launch();
    media.failAdopt = true;
    const take = media.stage('take1');
    assert.deepEqual(await app.controller.create(DRAFT, take), { ok: false, error: 'mediaFailed' });
    assert.deepEqual(app.controller.current().rallies, []);
    assert.deepEqual(app.stored()!.rallies, []);
    assert.equal(media.library.size, 0);
    assert.ok(media.staging.has(take));
  });

  test('a replacement is all or nothing: new audio that arrived is deleted when the photo fails', async () => {
    const { app, media, id } = await withOneSaved();
    const adopt = media.adopt.bind(media);
    let moves = 0;
    media.adopt = async (stagedName: string, fileName: string) => {
      moves += 1;
      if (moves === 2) throw new Error('photo failed');
      return adopt(stagedName, fileName);
    };
    app.access.current = 'pro';
    const result = await app.controller.replace(
      id,
      { audio: NEW_AUDIO, photo: { extension: 'jpg', width: 10, height: 10 } },
      { audio: media.stage('take2'), photo: media.stage('pic', 'jpg') },
    );
    assert.deepEqual(result, { ok: false, error: 'mediaFailed' });
    const rally = app.controller.current().rallies[0];
    assert.equal(rally.audio.fileName, `${id}-a1.m4a`);
    assert.equal(rally.photo, null);
    assert.equal(rally.replacing, null);
    assert.deepEqual(rally.retiredFiles, []);
    assert.deepEqual([...media.library.keys()], [`${id}-a1.m4a`]);
    assert.ok(media.staging.has('stage-pic.jpg'), 'the photo is still staged to try again');
  });

  test('a replacement whose move finished before reporting an error is completed', async () => {
    const { app, media, id } = await withOneSaved();
    media.afterAdopt = () => {
      media.afterAdopt = null;
      throw new Error('reported after the move');
    };
    const result = await app.controller.replace(id, { audio: NEW_AUDIO }, { audio: media.stage('take2') });
    assert.ok(result.ok);
    assert.equal(result.rally!.audio.fileName, `${id}-a2.m4a`);
    assert.deepEqual([...media.library.keys()], [`${id}-a2.m4a`]);
  });

  test('a deletion that removed the file but reported an error is finished at the next launch', async () => {
    const { app, store, media, id } = await withOneSaved();
    media.failAfterDelete.add(`${id}-a1.m4a`);
    assert.ok((await app.controller.delete(id)).ok);
    assert.equal(media.library.size, 0);
    assert.equal(app.stored()!.rallies[0].status, 'deleting');
    const next = await relaunch(store, media);
    assert.deepEqual(next.controller.current().rallies, []);
    assert.deepEqual(next.stored()!.rallies, []);
  });

  test('a reset whose deletion reported an error after removing the file is not reported as complete', async () => {
    const { app, store, media, id } = await withOneSaved();
    media.failAfterDelete.add(`${id}-a1.m4a`);
    assert.deepEqual(await app.controller.reset(), {
      ok: false,
      reason: 'filesRemain',
      failed: [`${LIBRARY_URI}${id}-a1.m4a`],
      remaining: [],
    });
    const next = await relaunch(store, media);
    assert.deepEqual(next.controller.current().rallies, []);
    assert.deepEqual(next.stored()!.rallies, []);
  });
});

describe('Recordings orphaned by corrupted metadata', () => {
  test('are kept and reported through launches, saves, deletes and recovery, never restored on their own, and removed only by Reset', async () => {
    const store = new MemoryStore({ [KEY]: '{"rallies": [' });
    const media = new MemoryMedia();
    const orphans = [`${A}-a1.m4a`, `${A}-p1.jpg`];
    media.library.set(orphans[0], 'orphan audio').set(orphans[1], 'orphan photo');
    const app = pepApp(store, media);
    await app.launch();
    assert.deepEqual(app.controller.health().unlisted, orphans);

    app.access.current = 'pro';
    const saved = await app.controller.create(DRAFT, media.stage('new'));
    assert.ok(saved.ok);
    assert.ok((await app.controller.delete(saved.rally!.id)).ok);
    assert.ok((await app.controller.recover()).ok);
    assert.deepEqual(app.controller.health().unlisted, orphans);

    const next = await relaunch(store, media);
    assert.deepEqual(next.controller.health().unlisted, orphans);
    assert.deepEqual(next.controller.current().rallies, [], 'not restored automatically');
    for (const name of orphans) assert.ok(next.media!.library.has(name));
    assert.ok(!media.deleted.some((uri) => uri.includes(A)), 'never deleted silently');

    assert.deepEqual(await next.controller.reset(), RESET_OK);
    assert.equal(next.media!.library.size, 0);
  });
});

describe('Pep Rallies stay separate from puff history and plans', () => {
  test('the controller writes only its own key', async () => {
    const { store } = await withOneSaved(new MemoryStore(EXISTING));
    assert.deepEqual([...new Set(store.writes)], [KEY]);
  });

  test('Clear puff history, logging and plan changes never touch Pep Rally metadata', async () => {
    const library: PepLibrary = libraryOf(storedRally(A));
    const store = new MemoryStore({ ...EXISTING, [KEY]: library, [`${KEY}-invalid-1`]: '{}' });
    const tracking = trackingApp(store);
    await tracking.launch();
    tracking.log('2026-10-01', 3);
    assert.ok(tracking.actions.start(REDUCE).ok);
    await tracking.clearLogs();
    tracking.actions.end();
    await tracking.flush();
    assert.deepEqual(store.json(KEY), library);
    assert.equal(store.keysStartingWith(`${KEY}-invalid-`).length, 1);
    assert.ok(!store.writes.includes(KEY));
  });
});
