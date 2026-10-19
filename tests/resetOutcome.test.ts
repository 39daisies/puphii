import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { createPepRallyController, PepResetResult } from '../src/data/pepRallyController';
import {
  createResetRunner,
  RESET_OUTCOME_MESSAGE,
  RESET_TRY_AGAIN_LABEL,
  ResetOutcome,
  resetOutcomeOf,
  RESETTING_LABEL,
} from '../src/data/resetOutcome';
import { MemoryStore } from './plan/storeHarness';
import { cloneStore, KEY, libraryOf, MemoryMedia, pepApp, storedRally } from './pepRally/fakes';

const A = 'pr-mgabc123-k3j9x0qa';
const OK: PepResetResult = { ok: true, reason: null, failed: [], remaining: [] };

const source = (...parts: string[]) => readFileSync(join(__dirname, '..', '..', 'src', ...parts), 'utf8');

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function launched(initial: Record<string, unknown> = {}, media: MemoryMedia | null = new MemoryMedia()) {
  const store = new MemoryStore(initial);
  const app = pepApp(store, media);
  await app.launch();
  return { app, store, media };
}

describe('Reset outcome', () => {
  test('only a confirmed result is done', () => {
    assert.equal(resetOutcomeOf(OK), 'done');
  });

  test('leftover files after deleting are partial', () => {
    assert.equal(resetOutcomeOf({ ok: false, reason: 'filesRemain', failed: ['x'], remaining: [] }), 'partial');
    assert.equal(resetOutcomeOf({ ok: false, reason: 'filesRemain', failed: [], remaining: ['y'] }), 'partial');
  });

  test('anything that could not be started, saved or checked is not finished', () => {
    for (const reason of ['storageUnavailable', 'saveFailed', 'noMediaStore', 'mediaFailed'] as const) {
      assert.equal(resetOutcomeOf({ ok: false, reason, failed: [], remaining: [] }), 'notFinished', reason);
    }
  });

  test('no result is never success', () => {
    assert.equal(resetOutcomeOf(null), 'notFinished');
    assert.equal(resetOutcomeOf(undefined), 'notFinished');
  });

  test('a result claiming ok while naming a problem or leftover files is not done', () => {
    assert.notEqual(resetOutcomeOf({ ok: true, reason: 'noMediaStore', failed: [], remaining: [] }), 'done');
    assert.notEqual(resetOutcomeOf({ ok: true, reason: null, failed: ['x'], remaining: [] }), 'done');
    assert.notEqual(resetOutcomeOf({ ok: true, reason: null, failed: [], remaining: ['y'] }), 'done');
    assert.notEqual(resetOutcomeOf({ ok: false, reason: null, failed: [], remaining: [] }), 'done');
  });

  test('the approved wording', () => {
    assert.equal(RESETTING_LABEL, 'Resetting…');
    assert.equal(RESET_TRY_AGAIN_LABEL, 'Try again');
    assert.equal(RESET_OUTCOME_MESSAGE.done, 'Puphii has been reset.');
    assert.equal(
      RESET_OUTCOME_MESSAGE.partial,
      "Puphii has been reset, but some recordings couldn't be deleted yet. Puphii will try again the next time it opens.",
    );
    assert.equal(RESET_OUTCOME_MESSAGE.notFinished, "Puphii couldn't finish resetting. Your recordings may still be on this device.");
  });

  test('the wording never names Pep Rallies', () => {
    for (const text of [RESETTING_LABEL, RESET_TRY_AGAIN_LABEL, ...Object.values(RESET_OUTCOME_MESSAGE)]) {
      assert.ok(!/pep|rall/i.test(text), text);
    }
  });
});

describe('Reset outcome from the real Pep Rally reset', () => {
  test('without a media store, even an empty library is not finished, and the marker stays', async () => {
    const { app, store } = await launched({}, null);
    assert.equal(app.controller.current().rallies.length, 0);
    assert.equal(resetOutcomeOf(await app.controller.reset()), 'notFinished');
    assert.equal(app.controller.resetPending(), true);
    assert.equal(typeof store.json(KEY)?.pendingReset, 'string');
  });

  test('without a media store, trying again is still not finished and never clears the marker', async () => {
    const { app, store } = await launched({}, null);
    await app.controller.reset();
    const marker = store.json(KEY)?.pendingReset;
    assert.equal(typeof marker, 'string');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      assert.equal(resetOutcomeOf(await app.controller.reset()), 'notFinished');
      assert.equal(app.controller.resetPending(), true);
    }
    assert.equal(store.json(KEY)?.pendingReset, marker);
  });

  test('without a media store, saved recordings are hidden but the reset is not finished', async () => {
    const { app } = await launched({ [KEY]: libraryOf(storedRally(A)) }, null);
    assert.equal(resetOutcomeOf(await app.controller.reset()), 'notFinished');
    assert.equal(app.controller.resetPending(), true);
    assert.ok(app.controller.current().rallies.every((rally) => rally.status === 'deleting'));
  });

  test('before the library has loaded, nothing is reset', async () => {
    const controller = createPepRallyController({ write: async () => undefined });
    const result = await controller.reset();
    assert.equal(result.reason, 'storageUnavailable');
    assert.equal(resetOutcomeOf(result), 'notFinished');
  });

  test('a failed save of the erased library is not finished', async () => {
    const { app } = await launched({ [KEY]: libraryOf(storedRally(A)) });
    app.io.failWrites = true;
    const result = await app.controller.reset();
    assert.equal(result.reason, 'saveFailed');
    assert.equal(resetOutcomeOf(result), 'notFinished');
  });

  test('a folder that cannot be read is not finished, and the marker stays', async () => {
    const media = new MemoryMedia();
    media.library.set(`${A}-a1.m4a`, 'voice');
    const { app } = await launched({ [KEY]: libraryOf(storedRally(A)) }, media);
    media.failList = true;
    const result = await app.controller.reset();
    assert.equal(result.reason, 'mediaFailed');
    assert.equal(resetOutcomeOf(result), 'notFinished');
    assert.equal(app.controller.resetPending(), true);
  });

  test('a file that cannot be deleted is partial, and the next launch finishes the reset as the message says', async () => {
    const media = new MemoryMedia();
    media.library.set(`${A}-a1.m4a`, 'voice');
    const { app, store } = await launched({ [KEY]: libraryOf(storedRally(A)) }, media);
    media.failDelete.add(`${A}-a1.m4a`);
    assert.equal(resetOutcomeOf(await app.controller.reset()), 'partial');
    assert.equal(app.controller.resetPending(), true);

    const files = media.clone();
    const next = pepApp(cloneStore(store), files);
    await next.launch();
    assert.equal(next.controller.resetPending(), false);
    assert.equal(files.library.size, 0);
  });

  test('a reset that confirms every file gone is done, and only then is the marker removed', async () => {
    const media = new MemoryMedia();
    media.library.set(`${A}-a1.m4a`, 'voice');
    const { app, store } = await launched({ [KEY]: libraryOf(storedRally(A)) }, media);
    assert.equal(resetOutcomeOf(await app.controller.reset()), 'done');
    assert.equal(app.controller.resetPending(), false);
    assert.equal(store.json(KEY)?.pendingReset, undefined);
    assert.equal(media.library.size, 0);
  });

  test('trying again after a partial reset can finish it', async () => {
    const media = new MemoryMedia();
    media.library.set(`${A}-a1.m4a`, 'voice');
    const { app } = await launched({ [KEY]: libraryOf(storedRally(A)) }, media);
    media.failDelete.add(`${A}-a1.m4a`);
    assert.equal(resetOutcomeOf(await app.controller.reset()), 'partial');
    media.failDelete.clear();
    assert.equal(resetOutcomeOf(await app.controller.reset()), 'done');
    assert.equal(app.controller.resetPending(), false);
  });
});

describe('Reset runner', () => {
  test('is running from the start until the outcome is known', async () => {
    const runner = createResetRunner();
    const reset = deferred<ResetOutcome>();
    assert.equal(runner.running, false);
    const run = runner.run(() => reset.promise, async () => undefined);
    assert.equal(runner.running, true);
    reset.resolve('done');
    assert.equal(await run, 'done');
    assert.equal(runner.running, false);
  });

  test('a second start while one is running does nothing', async () => {
    const runner = createResetRunner();
    const reset = deferred<ResetOutcome>();
    let resets = 0;
    let cancels = 0;
    const first = runner.run(
      () => {
        resets += 1;
        return reset.promise;
      },
      async () => {
        cancels += 1;
      },
    );
    const second = await runner.run(
      () => {
        resets += 1;
        return Promise.resolve('done');
      },
      async () => {
        cancels += 1;
      },
    );
    assert.equal(second, null);
    assert.equal(resets, 1);
    assert.equal(cancels, 1);
    reset.resolve('partial');
    assert.equal(await first, 'partial');
  });

  test('the reminder is cancelled whatever the outcome, and the outcome is passed through unchanged', async () => {
    for (const outcome of ['done', 'partial', 'notFinished'] as const) {
      let cancels = 0;
      const result = await createResetRunner().run(
        async () => outcome,
        async () => {
          cancels += 1;
        },
      );
      assert.equal(result, outcome);
      assert.equal(cancels, 1, outcome);
    }
  });

  test('the reminder is cancelled before the reset finishes', async () => {
    const reset = deferred<ResetOutcome>();
    let cancelled = false;
    const run = createResetRunner().run(
      () => reset.promise,
      async () => {
        cancelled = true;
      },
    );
    assert.equal(cancelled, true);
    reset.resolve('notFinished');
    await run;
  });

  test('a reset that rejects or throws is not finished, and the reminder is still cancelled', async () => {
    let cancels = 0;
    const cancel = async () => {
      cancels += 1;
    };
    assert.equal(await createResetRunner().run(() => Promise.reject(new Error('boom')), cancel), 'notFinished');
    assert.equal(
      await createResetRunner().run(() => {
        throw new Error('boom');
      }, cancel),
      'notFinished',
    );
    assert.equal(cancels, 2);
  });

  test('a problem cancelling the reminder never changes or hides the outcome', async () => {
    assert.equal(await createResetRunner().run(async () => 'notFinished', () => Promise.reject(new Error('denied'))), 'notFinished');
    assert.equal(
      await createResetRunner().run(
        async () => 'partial',
        () => {
          throw new Error('denied');
        },
      ),
      'partial',
    );
    assert.equal(await createResetRunner().run(async () => 'done', () => Promise.reject(new Error('denied'))), 'done');
  });

  test('trying again runs the reset again and reports the new outcome', async () => {
    const runner = createResetRunner();
    const outcomes: ResetOutcome[] = ['notFinished', 'partial', 'done'];
    let resets = 0;
    const results: (ResetOutcome | null)[] = [];
    for (let attempt = 0; attempt < outcomes.length; attempt += 1) {
      results.push(
        await runner.run(
          async () => outcomes[resets++],
          async () => undefined,
        ),
      );
    }
    assert.deepEqual(results, outcomes);
    assert.equal(resets, 3);
  });
});

describe('Data page and store wiring', () => {
  const settings = source('screens', 'SettingsScreen.tsx');
  const store = source('data', 'PuphiiStore.tsx');
  const buttons = source('components', 'Buttons.tsx');
  const resetAll = store.slice(store.indexOf('const resetAll = useCallback('), store.indexOf('useCallback(', store.indexOf('const resetAll = useCallback(') + 30));

  test('the success message is never shown unconditionally', () => {
    assert.ok(!settings.includes('Puphii has been reset.'), 'no hard-coded success message');
    assert.match(settings, /setDone\(RESET_OUTCOME_MESSAGE\[outcome\]\)/);
    assert.match(settings, /setResetIncomplete\(outcome !== 'done'\)/);
  });

  test('confirming the reset starts it through the runner, with the reminder cancelled every time', () => {
    assert.match(settings, /onConfirm=\{\(\) => \{\s*setConfirm\(null\);\s*startReset\(\);\s*\}\}/);
    assert.match(settings, /resetRunner\.run\(resetAll, cancelDailyReminder\)/);
    assert.match(settings, /if \(resetRunner\.running\) return;/);
  });

  test('the Reset button shows Resetting… and is disabled while a reset runs', () => {
    assert.match(settings, /label=\{resetting \? RESETTING_LABEL : 'Reset everything'\}/);
    assert.match(settings, /tone="destructiveOutline"\s+disabled=\{resetting\}\s+onPress=\{\(\) => setConfirm\('all'\)\}/);
    assert.match(settings, /setResetting\(true\);[\s\S]*resetRunner\.run[\s\S]*setResetting\(false\);/);
  });

  test('Try again appears only after an incomplete reset, and is disabled while one runs', () => {
    assert.match(
      settings,
      /\{resetIncomplete \? \(\s*<DialogButton label=\{RESET_TRY_AGAIN_LABEL\} tone="destructiveOutline" disabled=\{resetting\} onPress=\{startReset\}/,
    );
  });

  test('Clear puff history is unchanged and never offers Try again', () => {
    assert.match(settings, /clearLogs\(\);\s*setConfirm\(null\);\s*setResetIncomplete\(false\);\s*setDone\('Puff history cleared\.'\);/);
  });

  test('dialog buttons honour disabled', () => {
    const dialog = buttons.slice(buttons.indexOf('export function DialogButton'), buttons.indexOf('export function IconButton'));
    assert.match(dialog, /accessibilityState=\{\{ disabled: !!disabled \}\}/);
    assert.match(dialog, /disabled=\{disabled\}/);
    assert.match(dialog, /disabled && styles\.disabled/);
  });

  test('the store reports the outcome, keeps its order, and is never done before loading', () => {
    assert.match(resetAll, /async \(\): Promise<ResetOutcome> =>/);
    assert.match(resetAll, /if \(!readyRef\.current\) return 'notFinished';/);
    assert.match(resetAll, /const recordings = pepRallyController\.reset\(\);\s+planController\.reset\(\);\s+purgeBackups\(\[\.\.\.RESET_KEYS\]\);/);
    assert.match(resetAll, /return resetOutcomeOf\(await recordings\.catch\(\(\) => null\)\);/);
    assert.ok(resetAll.indexOf('queues.savings.save') < resetAll.indexOf('pepRallyController.reset()'), 'other data is reset first');
  });

  test('nothing about Pep Rallies is exposed to screens', () => {
    const contextType = store.slice(store.indexOf('type PuphiiStore = {'), store.indexOf('const StoreContext'));
    assert.ok(!/pepRall|PepLibrary|PepRally|hasRecordings/.test(contextType));
    assert.ok(!/pepRall|PepRally/i.test(settings));
  });
});
