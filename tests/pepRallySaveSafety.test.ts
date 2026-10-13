import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';
import { PepActionResult, PepResetResult, PepTakeResult } from '../src/data/pepRallyController';
import { STORAGE_KEYS } from '../src/data/storageKeys';
import { isSavedMediaUri } from '../src/pepRally/files';
import { beginReset, CreateDraft, endReset } from '../src/pepRally/lifecycle';
import { PepLibrary, sanitizePepLibrary, visibleRallies } from '../src/pepRally/model';
import { app as trackingApp, EXISTING, MemoryStore, REDUCE } from './plan/storeHarness';
import { cloneStore, DRAFT, KEY, libraryOf, LIBRARY_URI, MemoryMedia, NOW, pepApp, STAGING_URI, storedRally } from './pepRally/fakes';

const A = 'pr-mgabc123-k3j9x0qa';
const B = 'pr-mgabc124-z8y7w6vu';
const C = 'pr-mgabc125-m1n2b3v4';
const RESET_OK: PepResetResult = { ok: true, reason: null, failed: [], remaining: [] };

const audio = (durationMs: number) => ({ ...DRAFT.audio, durationMs });
const draft = (durationMs = 20_000): CreateDraft => ({ ...DRAFT, audio: audio(durationMs) });

/** `error`, or `error/upsell` when something is offered. */
const outcome = (result: PepActionResult | PepTakeResult): string =>
  result.ok ? 'ok' : result.upsell ? `${result.error}/${result.upsell}` : result.error;

async function launched(initial: Record<string, unknown> = {}, media = new MemoryMedia()) {
  const store = new MemoryStore(initial);
  const app = pepApp(store, media);
  await app.launch();
  return { app, store, media };
}

/** Restarts on storage and files exactly as they are now; `prepare` changes the device before launch. */
async function relaunch(store: MemoryStore, media: MemoryMedia, prepare?: (media: MemoryMedia) => void) {
  const files = media.clone();
  prepare?.(files);
  const app = pepApp(cloneStore(store), files);
  await app.launch();
  return app;
}

/** A library holding saved rallies whose files are on the device. */
async function withSaved(ids: string[], initial: Record<string, unknown> = {}) {
  const media = new MemoryMedia();
  for (const id of ids) media.library.set(`${id}-a1.m4a`, `voice ${id}`);
  return launched({ ...initial, [KEY]: libraryOf(...ids.map((id) => storedRally(id))) }, media);
}

describe('Recording length is fixed per take', () => {
  test('a take may record 30 seconds on Free and 60 on verified Pro', async () => {
    const { app, media } = await launched();
    app.access.current = 'free';
    assert.deepEqual(app.controller.openTake(media.stage('free1')), { ok: true, maxDurationMs: 30_000 });
    app.access.current = 'pro';
    assert.deepEqual(app.controller.openTake(media.stage('pro1')), { ok: true, maxDurationMs: 60_000 });
  });

  test('opening a take keeps the recording-count limits', async () => {
    const one = await withSaved([A]);
    one.app.access.current = 'free';
    assert.equal(outcome(one.app.controller.openTake(one.media.stage('t'))), 'limitReached/upgrade');
    const three = await withSaved([A, B, C]);
    three.app.access.current = 'free';
    assert.equal(outcome(three.app.controller.openTake(three.media.stage('t'))), 'limitReached/resubscribe');
    three.app.access.current = 'pro';
    assert.deepEqual(three.app.controller.openTake(three.media.stage('t2')), { ok: true, maxDurationMs: 60_000 });
  });

  test('no take can be opened without a usable media store', async () => {
    const store = new MemoryStore();
    const app = pepApp(store, null);
    await app.launch();
    app.access.current = 'pro';
    assert.deepEqual(app.controller.openTake('take-abc.m4a'), { ok: false, error: 'noMediaStore' });
  });

  test('a re-recording take is checked against the rally it replaces', async () => {
    const { app, media } = await withSaved([A]);
    app.access.current = 'free';
    assert.deepEqual(app.controller.openTake(media.stage('re1'), { kind: 'replaceAudio', id: A }), { ok: true, maxDurationMs: 30_000 });
    assert.deepEqual(app.controller.openTake(media.stage('nobody'), { kind: 'replaceAudio', id: B }), { ok: false, error: 'notFound' });
    app.access.current = 'pro';
    assert.deepEqual(app.controller.openTake(media.stage('re2'), { kind: 'replaceAudio', id: A }), { ok: true, maxDurationMs: 60_000 });
  });

  test('a Free re-recording stays a 30-second take after upgrading', async () => {
    const { app, media } = await withSaved([A]);
    app.access.current = 'free';
    const take = media.stage('re1');
    assert.ok(app.controller.openTake(take, { kind: 'replaceAudio', id: A }).ok);
    app.access.current = 'pro';
    assert.equal(outcome(await app.controller.replace(A, { audio: audio(45_000) }, { audio: take })), 'tooLong');
    assert.equal(visibleRallies(app.controller.current())[0].audio.fileName, `${A}-a1.m4a`);
    assert.equal(outcome(await app.controller.replace(A, { audio: audio(25_000) }, { audio: take })), 'ok');
  });

  test('a take serves only the action and recording it was opened for', async () => {
    const { app, media } = await withSaved([A, B]);
    app.access.current = 'pro';
    const forNew = media.stage('fornew');
    assert.ok(app.controller.openTake(forNew).ok);
    assert.equal(outcome(await app.controller.replace(A, { audio: audio(20_000) }, { audio: forNew })), 'takeMismatch');
    const forA = media.stage('fora');
    assert.ok(app.controller.openTake(forA, { kind: 'replaceAudio', id: A }).ok);
    assert.equal(outcome(await app.controller.replace(B, { audio: audio(20_000) }, { audio: forA })), 'takeMismatch');
    assert.equal(outcome(await app.controller.create(draft(), forA)), 'takeMismatch');
    assert.deepEqual(
      visibleRallies(app.controller.current()).map((rally) => rally.audio.fileName),
      [`${A}-a1.m4a`, `${B}-a1.m4a`],
    );
  });

  test('photos, unsafe names and takes already open are refused', async () => {
    const { app, media } = await launched();
    app.access.current = 'pro';
    const take = media.stage('once');
    assert.deepEqual(app.controller.openTake(media.stage('pic', 'jpg')), { ok: false, error: 'invalidAudio' });
    assert.deepEqual(app.controller.openTake('../escape.m4a'), { ok: false, error: 'invalidAudio' });
    assert.ok(app.controller.openTake(take).ok);
    assert.deepEqual(app.controller.openTake(take), { ok: false, error: 'busy' });
  });
});

describe('A recording is saved only once its file is confirmed excluded from backups', () => {
  test('the saved file itself is checked, never just its folder', async () => {
    const { app, media } = await launched();
    const take = media.stage('take');
    assert.ok(app.controller.openTake(take).ok);
    const result = await app.controller.create(draft(), take);
    assert.ok(result.ok);
    const fileName = result.rally!.audio.fileName;
    assert.deepEqual(media.exclusionChecks, [fileName]);
    assert.ok(media.excluded.has(fileName));
    assert.equal(app.stored()!.rallies[0].status, 'ready');
  });

  test('a "no" leaves the save unfinished, invisible, and the file where it was saved', async () => {
    const { app, media } = await launched();
    media.folderExcluded = true;
    media.exclusionAnswer = false;
    const take = media.stage('take');
    assert.ok(app.controller.openTake(take).ok);
    assert.deepEqual(await app.controller.create(draft(), take), { ok: false, error: 'notProtected' });
    assert.equal(visibleRallies(app.controller.current()).length, 0);
    const [rally] = app.stored()!.rallies;
    assert.equal(rally.status, 'pending');
    assert.deepEqual([...media.library.keys()], [rally.audio.fileName]);
    assert.equal(media.staging.size, 0);
    assert.equal(media.elsewhere.size, 1);
    assert.deepEqual(media.outside, []);
    assert.deepEqual(media.deleted, []);
  });

  test('anything but a plain true fails closed, including a missing or failing native check', async () => {
    const answers: [string, (media: MemoryMedia) => void][] = [
      ['false', (media) => (media.exclusionAnswer = false)],
      ['a string', (media) => (media.exclusionAnswer = 'true')],
      ['a number', (media) => (media.exclusionAnswer = 1)],
      ['null', (media) => (media.exclusionAnswer = null)],
      ['an object', (media) => (media.exclusionAnswer = {})],
      ['an error', (media) => (media.exclusionAnswer = new Error('native module missing'))],
      ['nothing', (media) => (media.excludeFromBackup = (async () => undefined) as unknown as MemoryMedia['excludeFromBackup'])],
      ['no method', (media) => (media.excludeFromBackup = undefined as unknown as MemoryMedia['excludeFromBackup'])],
    ];
    for (const [label, answer] of answers) {
      const { app, media } = await launched();
      answer(media);
      const take = media.stage('take');
      assert.ok(app.controller.openTake(take).ok, label);
      assert.deepEqual(await app.controller.create(draft(), take), { ok: false, error: 'notProtected' }, label);
      assert.equal(visibleRallies(app.controller.current()).length, 0, label);
    }
  });

  test('saving the same take again checks the same file once more and finishes it', async () => {
    const { app, media } = await launched();
    media.exclusionAnswer = false;
    const take = media.stage('take');
    assert.ok(app.controller.openTake(take).ok);
    assert.equal(outcome(await app.controller.create(draft(), take)), 'notProtected');
    const pendingId = app.stored()!.rallies[0].id;
    media.exclusionAnswer = undefined;
    const result = await app.controller.create(draft(), take);
    assert.ok(result.ok);
    assert.equal(result.rally!.id, pendingId);
    assert.deepEqual(media.exclusionChecks, [result.rally!.audio.fileName, result.rally!.audio.fileName]);
    assert.equal(media.library.size, 1);
    assert.equal(visibleRallies(app.controller.current()).length, 1);
  });

  test('a different recording on the same take does not finish the unprotected save', async () => {
    const { app, media } = await launched();
    media.exclusionAnswer = false;
    const take = media.stage('take');
    assert.ok(app.controller.openTake(take).ok);
    assert.equal(outcome(await app.controller.create(draft(20_000), take)), 'notProtected');
    media.exclusionAnswer = undefined;
    assert.equal(outcome(await app.controller.create(draft(21_000), take)), 'takeMismatch');
    assert.equal(visibleRallies(app.controller.current()).length, 0);
  });

  test('releasing the take undoes the unfinished save and deletes its file', async () => {
    const { app, media } = await launched();
    media.exclusionAnswer = false;
    const take = media.stage('take');
    assert.ok(app.controller.openTake(take).ok);
    await app.controller.create(draft(), take);
    const fileName = app.stored()!.rallies[0].audio.fileName;
    await app.controller.releaseTake(take);
    await app.controller.flush();
    assert.deepEqual(app.stored()!.rallies, []);
    assert.equal(media.library.size, 0);
    assert.ok(media.deleted.includes(`${LIBRARY_URI}${fileName}`));
  });

  test('at the next launch an unprotected save is discarded and reported, never shown', async () => {
    const { app, store, media } = await launched();
    media.exclusionAnswer = false;
    const take = media.stage('take');
    assert.ok(app.controller.openTake(take).ok);
    await app.controller.create(draft(), take);
    const [pending] = app.stored()!.rallies;

    const stillFailing = await relaunch(store, media, (files) => (files.exclusionAnswer = false));
    assert.deepEqual(stillFailing.controller.health().unprotected, [pending.id]);
    assert.deepEqual(stillFailing.controller.health().unlisted, []);
    assert.equal(visibleRallies(stillFailing.controller.current()).length, 0);
    assert.deepEqual(stillFailing.stored()!.rallies, []);

    const working = await relaunch(store, media);
    assert.deepEqual(working.controller.health().unprotected, []);
    assert.equal(visibleRallies(working.controller.current())[0].id, pending.id);
  });

  test('a re-recording that fails the check keeps the old audio until it is confirmed', async () => {
    const { app, store, media } = await withSaved([A]);
    app.access.current = 'pro';
    const take = media.stage('re1');
    assert.ok(app.controller.openTake(take, { kind: 'replaceAudio', id: A }).ok);
    media.exclusionAnswer = false;
    assert.equal(outcome(await app.controller.replace(A, { audio: audio(15_000) }, { audio: take })), 'notProtected');
    assert.equal(visibleRallies(app.controller.current())[0].audio.fileName, `${A}-a1.m4a`);
    assert.ok(media.library.has(`${A}-a1.m4a`));

    const relaunched = await relaunch(store, media, (files) => (files.exclusionAnswer = false));
    assert.deepEqual(relaunched.controller.health().unprotected, [A]);
    assert.equal(visibleRallies(relaunched.controller.current())[0].audio.fileName, `${A}-a1.m4a`);
    assert.equal(relaunched.stored()!.rallies[0].replacing, null);

    media.exclusionAnswer = undefined;
    const result = await app.controller.replace(A, { audio: audio(15_000) }, { audio: take });
    assert.ok(result.ok);
    assert.equal(result.rally!.audio.fileName, `${A}-a2.m4a`);
    await app.controller.flush();
    assert.ok(!media.library.has(`${A}-a1.m4a`));
  });

  test('releasing an unconfirmed re-recording keeps the old audio', async () => {
    const { app, media } = await withSaved([A]);
    app.access.current = 'pro';
    const take = media.stage('re1');
    assert.ok(app.controller.openTake(take, { kind: 'replaceAudio', id: A }).ok);
    media.exclusionAnswer = false;
    await app.controller.replace(A, { audio: audio(15_000) }, { audio: take });
    await app.controller.releaseTake(take);
    await app.controller.flush();
    assert.equal(app.stored()!.rallies[0].replacing, null);
    assert.deepEqual([...media.library.keys()], [`${A}-a1.m4a`]);
  });

  test('saved recordings never live in Documents, Caches or tmp', () => {
    const container = 'file:///var/mobile/Containers/Data/Application/0A1B2C3D/';
    assert.ok(isSavedMediaUri(LIBRARY_URI));
    for (const parent of ['Documents/', 'Library/Caches/', 'tmp/', 'Documents/Library/Application%20Support/']) {
      assert.equal(isSavedMediaUri(`${container}${parent}pep-rallies/`), false, parent);
    }
    assert.equal(isSavedMediaUri(STAGING_URI), false);
  });
});

describe('Reset everything survives being interrupted', () => {
  test('the marker is stored before any file is deleted and removed only after all are gone', async () => {
    const { app, store, media } = await withSaved([A], EXISTING);
    let atFirstDelete: PepLibrary | undefined;
    const remove = media.deleteFile.bind(media);
    media.deleteFile = async (uri) => {
      atFirstDelete ??= store.json(KEY);
      return remove(uri);
    };
    assert.deepEqual(await app.controller.reset(), RESET_OK);
    assert.ok(atFirstDelete?.pendingReset);
    assert.ok(atFirstDelete.rallies.every((rally) => rally.status === 'deleting'));
    assert.equal(app.stored()!.pendingReset, undefined);
    assert.equal(app.controller.resetPending(), false);
  });

  test('a reset killed mid-way finishes at the next launch before anything is offered back', async () => {
    const { app, store, media } = await withSaved([A, B], EXISTING);
    media.library.set(`${C}-a1.m4a`, 'unlisted');
    media.stage('old');
    let crash: { store: MemoryStore; media: MemoryMedia } | null = null;
    const remove = media.deleteFile.bind(media);
    media.deleteFile = async (uri) => {
      crash ??= { store: cloneStore(store), media: media.clone() };
      return remove(uri);
    };
    await app.controller.reset();
    assert.ok(crash);
    const { store: crashedStore, media: crashedMedia } = crash as { store: MemoryStore; media: MemoryMedia };
    assert.ok((crashedStore.json(KEY) as PepLibrary).pendingReset);

    const next = pepApp(crashedStore, crashedMedia);
    await next.launch();
    assert.deepEqual(next.controller.health().unlisted, []);
    assert.deepEqual(next.controller.current().rallies, []);
    assert.equal(next.controller.resetPending(), false);
    assert.equal(next.stored()!.pendingReset, undefined);
    assert.equal(crashedMedia.library.size, 0);
    assert.equal(crashedMedia.staging.size, 0);
    for (const key of Object.keys(EXISTING)) assert.equal(crashedStore.data.get(key), JSON.stringify(EXISTING[key as keyof typeof EXISTING]));
  });

  test('partially deleted recordings never come back, however many launches it takes', async () => {
    const orphans = [`${A}-a1.m4a`, `${A}-p1.jpg`];
    const media = new MemoryMedia();
    for (const name of orphans) media.library.set(name, 'old');
    const { app, store } = await launched({ [KEY]: '{"rallies": [' }, media);
    assert.deepEqual(app.controller.health().unlisted, orphans);

    media.failDelete.add(orphans[0]);
    assert.deepEqual(await app.controller.reset(), {
      ok: false,
      reason: 'filesRemain',
      failed: [`${LIBRARY_URI}${orphans[0]}`],
      remaining: [orphans[0]],
    });
    assert.deepEqual(app.controller.health().unlisted, []);
    assert.ok(app.controller.resetPending());
    assert.ok(!media.library.has(orphans[1]));

    const stuckStore = cloneStore(store);
    const stuckMedia = media.clone();
    stuckMedia.failDelete.add(orphans[0]);
    const stuck = pepApp(stuckStore, stuckMedia);
    await stuck.launch();
    assert.deepEqual(stuck.controller.health().unlisted, []);
    assert.equal(visibleRallies(stuck.controller.current()).length, 0);
    assert.ok(stuck.controller.resetPending());
    assert.ok((stuckStore.json(KEY) as PepLibrary).pendingReset);

    const fixed = await relaunch(stuckStore, stuckMedia);
    assert.deepEqual(fixed.controller.health().unlisted, []);
    assert.equal(fixed.controller.resetPending(), false);
    assert.equal(fixed.stored()!.pendingReset, undefined);
  });

  test('retrying in the same session finishes the reset and clears the marker', async () => {
    const { app, media } = await withSaved([A]);
    media.failDelete.add(`${A}-a1.m4a`);
    assert.equal((await app.controller.reset()).reason, 'filesRemain');
    assert.ok(app.stored()!.pendingReset);
    media.failDelete.clear();
    assert.deepEqual(await app.controller.reset(), RESET_OK);
    assert.equal(app.stored()!.pendingReset, undefined);
    assert.equal(media.library.size, 0);
  });

  test('a reset with no media store keeps the marker until one is attached', async () => {
    const store = new MemoryStore({ [KEY]: libraryOf(storedRally(A)) });
    const app = pepApp(store, null);
    await app.launch();
    assert.equal((await app.controller.reset()).reason, 'noMediaStore');
    assert.ok(app.stored()!.pendingReset);
    const media = new MemoryMedia();
    media.library.set(`${A}-a1.m4a`, 'old');
    const next = await relaunch(store, media);
    assert.equal(next.controller.resetPending(), false);
    assert.equal(next.stored()!.pendingReset, undefined);
    assert.deepEqual(next.controller.health().unlisted, []);
  });

  test('resetting repeatedly is harmless and leaves other data untouched', async () => {
    const { app, store, media } = await withSaved([A, B], EXISTING);
    for (let n = 0; n < 3; n++) assert.deepEqual(await app.controller.reset(), RESET_OK);
    assert.deepEqual(app.stored()!.rallies, []);
    assert.equal(app.stored()!.pendingReset, undefined);
    assert.equal(media.library.size, 0);
    assert.deepEqual(media.outside, []);
    assert.equal(media.elsewhere.size, 1);
    for (const key of Object.keys(EXISTING)) assert.equal(store.data.get(key), JSON.stringify(EXISTING[key as keyof typeof EXISTING]));

    const fresh = await launched();
    assert.deepEqual(await fresh.app.controller.reset(), RESET_OK);
    assert.equal(fresh.app.stored()?.pendingReset, undefined);
  });

  test('recordings saved after a failed reset survive when it is finished', async () => {
    const { app, store, media } = await withSaved([A]);
    media.failDelete.add(`${A}-a1.m4a`);
    assert.equal((await app.controller.reset()).reason, 'filesRemain');
    app.access.current = 'pro';
    const take = media.stage('after');
    assert.ok(app.controller.openTake(take).ok);
    const saved = await app.controller.create(draft(), take);
    assert.ok(saved.ok);
    await app.controller.flush();

    const next = await relaunch(store, media);
    assert.equal(next.controller.resetPending(), false);
    assert.deepEqual(
      visibleRallies(next.controller.current()).map((rally) => rally.id),
      [saved.rally!.id],
    );
    assert.equal(next.media!.library.has(saved.rally!.audio.fileName), true);
    assert.equal(next.media!.library.has(`${A}-a1.m4a`), false);
  });

  test('clearing puff history leaves an unfinished reset and its marker alone', async () => {
    const library = { ...libraryOf(storedRally(A, { status: 'deleting' })), pendingReset: NOW.toISOString() };
    const store = new MemoryStore({ ...EXISTING, [KEY]: library });
    const tracking = trackingApp(store);
    await tracking.launch();
    tracking.log('2026-10-01', 3);
    assert.ok(tracking.actions.start(REDUCE).ok);
    await tracking.clearLogs();
    tracking.actions.end();
    await tracking.flush();
    assert.deepEqual(store.json(KEY), library);
    assert.notEqual(store.data.get(STORAGE_KEYS.logs), JSON.stringify(EXISTING[STORAGE_KEYS.logs]));
  });

  test('an unreadable marker still counts as an unfinished reset', () => {
    const at = '2026-10-13T08:00:00.000Z';
    assert.equal(sanitizePepLibrary({ ...libraryOf(), pendingReset: at }).pendingReset, at);
    for (const garbled of ['soon', true, 7, {}]) {
      assert.equal(sanitizePepLibrary({ ...libraryOf(), pendingReset: garbled }).pendingReset, new Date(0).toISOString(), String(garbled));
    }
    for (const none of [undefined, null, false]) {
      assert.equal('pendingReset' in sanitizePepLibrary({ ...libraryOf(), pendingReset: none }), false, String(none));
    }
  });

  test('starting a reset again keeps the first marker; ending it removes only the marker', () => {
    const first = beginReset(libraryOf(storedRally(A)), NOW);
    const later = new Date(NOW.getTime() + 60_000);
    assert.equal(beginReset(first, later), first);
    const withNew = { ...first, rallies: [...first.rallies, storedRally(B)] };
    assert.equal(beginReset(withNew, later).pendingReset, first.pendingReset);
    const ended = endReset(first);
    assert.equal('pendingReset' in ended, false);
    assert.deepEqual(ended.rallies, first.rallies);
  });
});

const RETRYABLE = ['saveFailed', 'mediaFailed', 'notProtected'] as const;

/** A verified-Pro take whose save fails while Pro has lapsed to Free. `prepare` changes the device first. */
async function failedProTake(failure: (typeof RETRYABLE)[number], seconds = 58, prepare?: (media: MemoryMedia) => void) {
  const media = new MemoryMedia();
  prepare?.(media);
  const setup = await launched({}, media);
  const { app } = setup;
  app.access.current = 'pro';
  const take = media.stage('retry', 'm4a', 'the original recording');
  assert.ok(app.controller.openTake(take).ok);
  app.access.current = 'free';
  if (failure === 'saveFailed') app.io.failWrites = true;
  if (failure === 'mediaFailed') media.failAdopt = true;
  if (failure === 'notProtected') media.exclusionAnswer = false;
  assert.equal(outcome(await app.controller.create(draft(seconds * 1000), take)), failure);
  app.io.failWrites = false;
  media.failAdopt = false;
  media.exclusionAnswer = undefined;
  return { ...setup, take };
}

describe('A storage failure may be retried on the same take without renewed Pro', () => {
  const failures = RETRYABLE;

  test('the same take and recording can be saved again after Pro lapsed', async () => {
    for (const failure of failures) {
      const { app, media, take } = await failedProTake(failure);
      const saved = await app.controller.create(draft(58_000), take);
      assert.ok(saved.ok, failure);
      assert.equal(visibleRallies(app.controller.current()).length, 1, failure);
      assert.equal(media.library.size, 1, failure);
      media.stage('retry');
      assert.equal(outcome(await app.controller.create(draft(58_000), take)), 'limitReached/resubscribe', `${failure}: used up`);
    }
  });

  test('a different recording on the same take gets current access and uses the allowance up', async () => {
    for (const failure of ['saveFailed', 'mediaFailed'] as const) {
      const { app, take } = await failedProTake(failure);
      assert.equal(outcome(await app.controller.create(draft(55_000), take)), 'tooLong/upgrade', failure);
      assert.equal(outcome(await app.controller.create(draft(58_000), take)), 'tooLong/upgrade', failure);
    }
    const { app, take } = await failedProTake('notProtected');
    assert.equal(outcome(await app.controller.create(draft(55_000), take)), 'takeMismatch');
    assert.equal(outcome(await app.controller.create(draft(58_000), take)), 'tooLong/upgrade');
    assert.equal(visibleRallies(app.controller.current()).length, 0);
  });

  test('the allowance cannot start another recording or replace a different one', async () => {
    const { app, media, take } = await failedProTake('saveFailed');
    const other = media.stage('other');
    assert.deepEqual(app.controller.openTake(other), { ok: true, maxDurationMs: 30_000 });
    assert.equal(outcome(await app.controller.create(draft(58_000), other)), 'tooLong/upgrade');
    assert.equal(outcome(await app.controller.create(draft(58_000), media.stage('unopened'))), 'tooLong/upgrade');
    assert.equal(outcome(await app.controller.create(draft(58_000), take)), 'ok');

    const saved = await withSaved([A, B]);
    saved.app.access.current = 'pro';
    const forA = saved.media.stage('fora');
    assert.ok(saved.app.controller.openTake(forA, { kind: 'replaceAudio', id: A }).ok);
    saved.app.access.current = 'free';
    saved.app.io.failWrites = true;
    assert.equal(outcome(await saved.app.controller.replace(A, { audio: audio(50_000) }, { audio: forA })), 'saveFailed');
    saved.app.io.failWrites = false;
    assert.equal(outcome(await saved.app.controller.replace(B, { audio: audio(50_000) }, { audio: forA })), 'takeMismatch');
    assert.equal(outcome(await saved.app.controller.replace(A, { audio: audio(50_000) }, { audio: forA })), 'limitReached/resubscribe');
  });

  test('a retry cannot pass the 50-recording limit', async () => {
    const ids = Array.from({ length: 49 }, (_, n) => `pr-full${n.toString(36).padStart(2, '0')}-testtest`);
    const { app, media } = await withSaved(ids);
    app.access.current = 'pro';
    const take = media.stage('last');
    assert.ok(app.controller.openTake(take).ok);
    app.io.failWrites = true;
    assert.equal(outcome(await app.controller.create(draft(50_000), take)), 'saveFailed');
    app.io.failWrites = false;
    assert.ok((await app.controller.create(draft(), media.stage('fills'))).ok);
    app.access.current = 'free';
    assert.equal(outcome(await app.controller.create(draft(50_000), take)), 'libraryFull');
  });

  test('a cancelled take, an unrecoverable failure or a restart ends the allowance', async () => {
    const cancelled = await failedProTake('saveFailed');
    await cancelled.app.controller.releaseTake(cancelled.take);
    cancelled.media.stage('retry');
    assert.deepEqual(cancelled.app.controller.openTake(cancelled.take), { ok: true, maxDurationMs: 30_000 });
    assert.equal(outcome(await cancelled.app.controller.create(draft(58_000), cancelled.take)), 'tooLong/upgrade');

    const unrecoverable = await failedProTake('saveFailed');
    assert.equal(outcome(await unrecoverable.app.controller.create({ ...draft(58_000), title: '' }, unrecoverable.take)), 'invalidTitle');
    assert.equal(outcome(await unrecoverable.app.controller.create(draft(58_000), unrecoverable.take)), 'tooLong/upgrade');

    const restarted = await failedProTake('saveFailed');
    const next = pepApp(cloneStore(restarted.store), restarted.media.clone());
    await next.launch({ recover: false });
    assert.equal(outcome(await next.controller.create(draft(58_000), restarted.take)), 'tooLong/upgrade');
  });

  test('unavailable access always wins over the allowance', async () => {
    for (const failure of failures) {
      const { app, take } = await failedProTake(failure);
      app.access.current = 'unavailable';
      assert.equal(outcome(await app.controller.create(draft(58_000), take)), 'unavailable', failure);
      app.access.current = 'free';
      assert.equal(outcome(await app.controller.create(draft(58_000), take)), 'tooLong/upgrade', `${failure}: used up`);
    }
  });

  test('busy and other refusals are not storage failures and do not keep the allowance', async () => {
    const { app, media } = await launched();
    app.access.current = 'pro';
    const take = media.stage('retry');
    assert.ok(app.controller.openTake(take).ok);
    app.access.current = 'free';
    assert.equal(outcome(await app.controller.create({ ...draft(58_000), consentConfirmed: false, voice: 'someoneElse' }, take)), 'consentRequired');
    assert.equal(outcome(await app.controller.create(draft(58_000), take)), 'tooLong/upgrade');
  });
});

describe('A retry keeps the Pro allowance only for the same file bytes', () => {
  const SAME_SIZE_DIFFERENT = 'a different recording!';
  const sha = (content: string) => createHash('sha256').update(content).digest('hex');

  /** After the allowance is gone, the original recording gets only current Free terms. */
  async function allowanceGone(app: Awaited<ReturnType<typeof launched>>['app'], media: MemoryMedia, take: string) {
    media.staging.set(take, 'the original recording');
    assert.equal(outcome(await app.controller.create(draft(58_000), take)), 'tooLong/upgrade');
  }

  test('different bytes with the same name, duration, format and size are rejected', async () => {
    const { app, media, take } = await failedProTake('mediaFailed');
    assert.equal(SAME_SIZE_DIFFERENT.length, 'the original recording'.length);
    media.staging.set(take, SAME_SIZE_DIFFERENT);
    assert.deepEqual(await app.controller.create(draft(58_000), take), { ok: false, error: 'takeMismatch' });
    assert.equal(visibleRallies(app.controller.current()).length, 0);
    assert.equal(media.library.size, 0);
    await allowanceGone(app, media, take);
  });

  test('a file swapped after saveFailed is rejected and the allowance is gone for good', async () => {
    const { app, media, take } = await failedProTake('saveFailed');
    media.staging.set(take, SAME_SIZE_DIFFERENT);
    assert.equal(outcome(await app.controller.create(draft(58_000), take)), 'takeMismatch');
    assert.deepEqual(app.stored()?.rallies ?? [], []);
    await allowanceGone(app, media, take);
  });

  test('a file swapped after notProtected is rejected and the unfinished save is undone', async () => {
    const swappedInPlace = await failedProTake('notProtected');
    const [pending] = swappedInPlace.app.stored()!.rallies;
    swappedInPlace.media.library.set(pending.audio.fileName, SAME_SIZE_DIFFERENT);
    assert.equal(outcome(await swappedInPlace.app.controller.create(draft(58_000), swappedInPlace.take)), 'takeMismatch');
    await swappedInPlace.app.controller.flush();
    assert.equal(visibleRallies(swappedInPlace.app.controller.current()).length, 0);
    assert.deepEqual(swappedInPlace.app.stored()!.rallies, []);
    assert.equal(swappedInPlace.media.library.size, 0);

    const takeReturned = await failedProTake('notProtected');
    takeReturned.media.staging.set(takeReturned.take, SAME_SIZE_DIFFERENT);
    assert.equal(outcome(await takeReturned.app.controller.create(draft(58_000), takeReturned.take)), 'takeMismatch');
    assert.equal(outcome(await takeReturned.app.controller.create(draft(58_000), takeReturned.take)), 'tooLong/upgrade');
    assert.equal(visibleRallies(takeReturned.app.controller.current()).length, 0);
    assert.equal(takeReturned.media.library.size, 0);
  });

  test('a file swapped during the move is caught before the save is finished', async () => {
    const { app, media } = await launched();
    app.access.current = 'pro';
    const take = media.stage('swap', 'm4a', 'the original recording');
    assert.ok(app.controller.openTake(take).ok);
    app.access.current = 'free';
    media.beforeAdopt = () => {
      media.staging.set(take, SAME_SIZE_DIFFERENT);
    };
    assert.deepEqual(await app.controller.create(draft(58_000), take), { ok: false, error: 'takeMismatch' });
    assert.equal(visibleRallies(app.controller.current()).length, 0);
    assert.deepEqual(app.stored()!.rallies, []);
    assert.equal(media.library.size, 0);
    assert.deepEqual(media.exclusionChecks, [], 'never finished');

    const replaced = await withSaved([A]);
    replaced.app.access.current = 'pro';
    const re = replaced.media.stage('re1', 'm4a', 'the original recording');
    assert.ok(replaced.app.controller.openTake(re, { kind: 'replaceAudio', id: A }).ok);
    replaced.app.access.current = 'free';
    replaced.media.beforeAdopt = () => {
      replaced.media.staging.set(re, SAME_SIZE_DIFFERENT);
    };
    assert.equal(outcome(await replaced.app.controller.replace(A, { audio: audio(50_000) }, { audio: re })), 'takeMismatch');
    assert.equal(visibleRallies(replaced.app.controller.current())[0].audio.fileName, `${A}-a1.m4a`);
    assert.deepEqual([...replaced.media.library.keys()], [`${A}-a1.m4a`]);
  });

  test('a failed check of the saved file never exposes the recording, now or after a restart', async () => {
    for (const answer of ['not-a-hash', sha('x').toUpperCase(), '', null, new Error('read failed')]) {
      const { app, store, media } = await launched();
      const real = media.fingerprint.bind(media);
      media.fingerprint = async (folder, name) => {
        if (folder === 'staging') return real(folder, name);
        if (answer instanceof Error) throw answer;
        return answer as string;
      };
      app.access.current = 'pro';
      const take = media.stage('take', 'm4a', 'the original recording');
      assert.ok(app.controller.openTake(take).ok);
      app.access.current = 'free';
      assert.deepEqual(await app.controller.create(draft(58_000), take), { ok: false, error: 'mediaUnverified' }, String(answer));
      assert.equal(visibleRallies(app.controller.current()).length, 0);
      assert.equal(media.library.size, 0);
      const next = await relaunch(store, media);
      assert.equal(visibleRallies(next.controller.current()).length, 0);
      assert.deepEqual(next.controller.health().completed, []);
    }
  });

  test('an unchanged file retries with its allowance, checked in staging and again once in place', async () => {
    const { app, media, take } = await failedProTake('saveFailed');
    const saved = await app.controller.create(draft(58_000), take);
    assert.ok(saved.ok);
    assert.deepEqual(media.fingerprintChecks, [`staging/${take}`, `staging/${take}`, `library/${saved.rally!.audio.fileName}`]);
    assert.equal(media.library.get(saved.rally!.audio.fileName), 'the original recording');
  });

  test('a missing or invalid fingerprint fails closed: no retry keeps the allowance', async () => {
    const invalid: [string, (media: MemoryMedia) => void][] = [
      ['empty', (media) => (media.fingerprintAnswer = '')],
      ['too short', (media) => (media.fingerprintAnswer = 'abc123')],
      ['uppercase', (media) => (media.fingerprintAnswer = sha('x').toUpperCase())],
      ['a number', (media) => (media.fingerprintAnswer = 42)],
      ['null', (media) => (media.fingerprintAnswer = null)],
      ['an object', (media) => (media.fingerprintAnswer = { sha256: sha('x') })],
      ['an error', (media) => (media.fingerprintAnswer = new Error('unavailable'))],
    ];
    for (const [label, prepare] of invalid) {
      const { app, take } = await failedProTake('saveFailed', 58, prepare);
      assert.equal(outcome(await app.controller.create(draft(58_000), take)), 'tooLong/upgrade', label);
    }
    const lost = await failedProTake('saveFailed');
    lost.media.fingerprintAnswer = new Error('unavailable');
    assert.equal(outcome(await lost.app.controller.create(draft(58_000), lost.take)), 'mediaUnverified');
    lost.media.fingerprintAnswer = undefined;
    assert.equal(outcome(await lost.app.controller.create(draft(58_000), lost.take)), 'tooLong/upgrade');
  });

  test('without fingerprint support, the first save keeps D2 but a retry gets only current access', async () => {
    const unsupported = (media: MemoryMedia) => {
      (media as { fingerprint?: unknown }).fingerprint = undefined;
    };
    const first = new MemoryMedia();
    unsupported(first);
    const { app } = await launched({}, first);
    app.access.current = 'pro';
    const take = first.stage('d2');
    assert.ok(app.controller.openTake(take).ok);
    app.access.current = 'free';
    assert.equal(outcome(await app.controller.create(draft(58_000), take)), 'ok');

    for (const failure of RETRYABLE) {
      const retried = await failedProTake(failure, 58, unsupported);
      assert.equal(outcome(await retried.app.controller.create(draft(58_000), retried.take)), 'tooLong/upgrade', failure);
      assert.equal(visibleRallies(retried.app.controller.current()).length, 0, failure);
    }
  });

  test('a rejected retry is never treated as retryable', async () => {
    const { app, media, take } = await failedProTake('saveFailed');
    media.staging.set(take, SAME_SIZE_DIFFERENT);
    const rejected = await app.controller.create(draft(58_000), take);
    assert.ok(!rejected.ok && !RETRYABLE.includes(rejected.error as (typeof RETRYABLE)[number]));
    app.access.current = 'pro';
    media.staging.set(take, 'the original recording');
    assert.equal(outcome(await app.controller.create(draft(58_000), take)), 'ok', 'current verified Pro still works');
  });
});

describe('Staged files from before a reset are never saved', () => {
  /** A failed reset that leaves `names` in staging because they can't be deleted. */
  async function failedResetWithStaged(names: [string, 'm4a' | 'jpg'][]) {
    const setup = await withSaved([A]);
    const staged = names.map(([token, extension]) => setup.media.stage(token, extension, `pre-reset ${token}`));
    for (const name of staged) setup.media.failDelete.add(name);
    assert.equal((await setup.app.controller.reset()).reason, 'filesRemain');
    assert.ok(setup.app.controller.resetPending());
    return { ...setup, staged };
  }

  test('a pre-reset staged import cannot become a rally after a failed reset', async () => {
    const { app, media, staged } = await failedResetWithStaged([['import', 'm4a']]);
    app.access.current = 'pro';
    assert.deepEqual(await app.controller.create(DRAFT, staged[0]), { ok: false, error: 'discarded' });
    assert.equal(visibleRallies(app.controller.current()).length, 0);
    assert.ok(media.staging.has(staged[0]), 'still undeletable');
    media.failDelete.clear();
    assert.deepEqual(await app.controller.create(DRAFT, staged[0]), { ok: false, error: 'discarded' });
    assert.equal(media.staging.size, 0);
    assert.equal(visibleRallies(app.controller.current()).length, 0);
  });

  test('a pre-reset staged photo cannot be attached to a rally saved since', async () => {
    const { app, media, staged } = await failedResetWithStaged([['pic', 'jpg']]);
    app.access.current = 'pro';
    const take = media.stage('after');
    assert.ok(app.controller.openTake(take).ok);
    const saved = await app.controller.create(DRAFT, take);
    assert.ok(saved.ok);
    const photo = { extension: 'jpg', width: 10, height: 10 } as const;
    assert.equal(outcome(await app.controller.replace(saved.rally!.id, { photo }, { photo: staged[0] })), 'discarded');
    assert.equal(visibleRallies(app.controller.current())[0].photo, null);
  });

  test('a stale staged name cannot be opened as a take until its deletion is confirmed', async () => {
    const { app, media, staged } = await failedResetWithStaged([['reused', 'm4a']]);
    app.access.current = 'pro';
    assert.deepEqual(app.controller.openTake(staged[0]), { ok: false, error: 'busy' });
    media.failDelete.clear();
    assert.deepEqual(await app.controller.reset(), RESET_OK);
    assert.deepEqual(app.controller.openTake(staged[0]), { ok: true, maxDurationMs: 60_000 });
  });

  test('a file whose deletion errored is released only once a listing confirms it is gone', async () => {
    const { app, media } = await withSaved([A]);
    const name = media.stage('late');
    media.failAfterDelete.add(name);
    assert.equal((await app.controller.reset()).reason, 'filesRemain');
    assert.ok(!media.staging.has(name));
    app.access.current = 'pro';
    assert.ok(app.controller.openTake(name).ok);
  });

  test('after a restart with the reset still pending, leftovers stay unsaveable', async () => {
    const { store, media, staged } = await failedResetWithStaged([['left', 'm4a']]);
    const stuck = await relaunch(store, media, (files) => files.failDelete.add(staged[0]));
    stuck.access.current = 'pro';
    assert.ok(stuck.controller.resetPending());
    assert.deepEqual(await stuck.controller.create(DRAFT, staged[0]), { ok: false, error: 'discarded' });
    assert.deepEqual(stuck.controller.openTake(staged[0]), { ok: false, error: 'busy' });

    const unrecovered = pepApp(cloneStore(store), media.clone());
    await unrecovered.launch({ recover: false });
    unrecovered.access.current = 'pro';
    assert.deepEqual(await unrecovered.controller.create(DRAFT, staged[0]), { ok: false, error: 'busy' });
    assert.deepEqual(unrecovered.controller.openTake(unrecovered.media!.stage('fresh')), { ok: false, error: 'busy' });
    assert.equal(visibleRallies(unrecovered.controller.current()).length, 0);
  });

  test('genuinely new takes and imports staged after the reset began are still saved', async () => {
    const { app, media } = await failedResetWithStaged([['old', 'm4a']]);
    app.access.current = 'pro';
    const take = media.stage('newtake');
    assert.ok(app.controller.openTake(take).ok);
    assert.ok((await app.controller.create(DRAFT, take)).ok);
    const imported = media.stage('newimport');
    assert.ok((await app.controller.create(DRAFT, imported)).ok);
    assert.equal(visibleRallies(app.controller.current()).length, 2);
  });
});
