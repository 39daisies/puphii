import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { ProAccess } from '../src/subscription/entitlement';
import { canCreate, canUseProExtras, PEP_TIER_LIMITS, pepTierFor, savedCount } from '../src/pepRally/access';
import {
  abandonCreate,
  abandonReplacement,
  beginCreate,
  beginDelete,
  beginReplacement,
  beginReset,
  cancelDelete,
  completeCreate,
  completeReplacement,
  CreateDraft,
  filesToDelete,
  forgetFiles,
  markPlayed,
  PepResult,
  removePhoto,
  rename,
  setFavorite,
  setTags,
} from '../src/pepRally/lifecycle';
import { defaultPepLibrary, filesOf, findRally, PepLibrary, visibleRallies } from '../src/pepRally/model';
import { recoverLibrary } from '../src/pepRally/recovery';
import { DRAFT, libraryOf, NOW, storedRally } from './pepRally/fakes';

const ACCESS: readonly ProAccess[] = ['granted', 'denied', 'checking'];
const idFor = (n: number) => `pr-${n.toString(36)}-abcdefgh`;
const ok = (result: PepResult): PepLibrary => {
  assert.ok(result.ok, result.ok ? '' : result.error);
  return result.library;
};
const errorOf = (result: PepResult) => (result.ok ? 'ok' : result.error);

/** Saves `count` rallies the way the controller does, with the given access. */
function saved(count: number, pro: ProAccess, draft: CreateDraft = DRAFT): PepLibrary {
  let library = defaultPepLibrary();
  for (let n = 0; n < count; n += 1) {
    library = ok(beginCreate(library, idFor(n), draft, pro, NOW));
    library = ok(completeCreate(library, idFor(n), NOW));
  }
  return library;
}

describe('Free and Pro limits', () => {
  test('only granted access counts as Pro; checking and denied follow Free limits', () => {
    assert.equal(pepTierFor('granted'), 'pro');
    assert.equal(pepTierFor('denied'), 'free');
    assert.equal(pepTierFor('checking'), 'free');
    assert.deepEqual(PEP_TIER_LIMITS, { free: { maxSaved: 1, maxDurationMs: 30_000 }, pro: { maxSaved: 50, maxDurationMs: 60_000 } });
  });

  test('Free saves one Pep Rally; Pro saves up to 50', () => {
    const free = saved(1, 'denied');
    assert.equal(errorOf(beginCreate(free, idFor(9), DRAFT, 'denied', NOW)), 'limitReached');
    assert.equal(errorOf(beginCreate(free, idFor(9), DRAFT, 'checking', NOW)), 'limitReached');
    const pro = saved(50, 'granted');
    assert.equal(savedCount(pro), 50);
    assert.equal(errorOf(beginCreate(pro, idFor(99), DRAFT, 'granted', NOW)), 'limitReached');
  });

  test('a Pep Rally being saved counts toward the limit; one being deleted does not', () => {
    const pending = ok(beginCreate(defaultPepLibrary(), idFor(1), DRAFT, 'denied', NOW));
    assert.equal(errorOf(beginCreate(pending, idFor(2), DRAFT, 'denied', NOW)), 'limitReached');
    const deleting = ok(beginDelete(saved(1, 'denied'), idFor(0), NOW));
    assert.equal(canCreate(deleting, 'denied').ok, true);
  });

  test('length limits: 30 seconds for Free, 60 for Pro, with a small allowance for recorder overrun', () => {
    const at = (durationMs: number, pro: ProAccess) =>
      errorOf(beginCreate(defaultPepLibrary(), idFor(1), { ...DRAFT, audio: { ...DRAFT.audio, durationMs } }, pro, NOW));
    assert.equal(at(30_000, 'denied'), 'ok');
    assert.equal(at(30_500, 'denied'), 'ok');
    assert.equal(at(30_501, 'denied'), 'tooLong');
    assert.equal(at(45_000, 'checking'), 'tooLong');
    assert.equal(at(60_500, 'granted'), 'ok');
    assert.equal(at(60_501, 'granted'), 'tooLong');
    for (const bad of [0, -5, 1.5, Number.NaN]) assert.equal(at(bad, 'granted'), 'invalidAudio', String(bad));
  });

  test('photos, tags and favorites need Pro; existing ones stay after Pro ends', () => {
    assert.equal(canUseProExtras('granted'), true);
    assert.equal(canUseProExtras('denied'), false);
    assert.equal(errorOf(beginCreate(defaultPepLibrary(), idFor(1), { ...DRAFT, tags: ['craving'] }, 'denied', NOW)), 'proRequired');
    assert.equal(errorOf(beginCreate(defaultPepLibrary(), idFor(1), { ...DRAFT, favorite: true }, 'checking', NOW)), 'proRequired');
    assert.equal(errorOf(beginCreate(defaultPepLibrary(), idFor(1), { ...DRAFT, tags: ['craving'], favorite: true }, 'granted', NOW)), 'ok');
  });

  test('after Pro ends, every existing recording can still be played, renamed, have its photo removed and be deleted', () => {
    let library = saved(5, 'granted', { ...DRAFT, audio: { ...DRAFT.audio, durationMs: 58_000 }, tags: ['work'], favorite: true });
    const id = idFor(0);
    library = ok(beginReplacement(library, id, { photo: { extension: 'jpg', width: 900, height: 900 } }, 'granted', NOW));
    library = ok(completeReplacement(library, id, NOW));
    const before = findRally(library, id)!;

    for (const pro of ['denied', 'checking'] as const) {
      assert.equal(errorOf(beginCreate(library, idFor(10), DRAFT, pro, NOW)), 'limitReached');
      assert.equal(errorOf(setTags(library, id, ['work', 'morning'], pro, NOW)), 'proRequired');
      assert.equal(errorOf(setFavorite(library, id, false, pro, NOW)), 'ok');
      assert.equal(errorOf(beginReplacement(library, id, { photo: { extension: 'jpg', width: 1, height: 1 } }, pro, NOW)), 'proRequired');
      assert.equal(errorOf(beginReplacement(library, id, { audio: { ...DRAFT.audio, durationMs: 20_000 } }, pro, NOW)), 'limitReached');
    }
    assert.equal(visibleRallies(library).length, 5, 'nothing is hidden or locked');
    assert.equal(findRally(library, id)!.audio.durationMs, 58_000);
    assert.deepEqual(findRally(library, id)!.tags, ['work']);
    assert.equal(findRally(library, id)!.favorite, true);

    const played = ok(markPlayed(library, id, NOW));
    const renamed = ok(rename(played, id, 'Still mine', NOW));
    const photoRemoved = ok(removePhoto(renamed, id, NOW));
    assert.deepEqual(findRally(photoRemoved, id)!.retiredFiles, [before.photo!.fileName]);
    const deleted = ok(beginDelete(photoRemoved, id, NOW));
    assert.equal(visibleRallies(deleted).length, 4);
  });

  test('after Pro ends, favorites, tags and photos can still be removed, but not added', () => {
    let library = saved(2, 'granted', { ...DRAFT, tags: ['work', 'morning', 'tough'], favorite: true });
    const id = idFor(0);
    library = ok(beginReplacement(library, id, { photo: { extension: 'jpg', width: 900, height: 900 } }, 'granted', NOW));
    library = ok(completeReplacement(library, id, NOW));

    for (const pro of ['denied', 'checking'] as const) {
      const unfavorited = ok(setFavorite(library, id, false, pro, NOW));
      assert.equal(findRally(unfavorited, id)!.favorite, false);
      assert.equal(errorOf(setFavorite(unfavorited, id, true, pro, NOW)), 'proRequired', 'marking it again needs Pro');
      assert.equal(ok(setFavorite(library, id, true, pro, NOW)), library, 'leaving a favorite as it is changes nothing');

      assert.deepEqual(findRally(ok(setTags(library, id, ['work', 'tough'], pro, NOW)), id)!.tags, ['work', 'tough']);
      assert.deepEqual(findRally(ok(setTags(library, id, [], pro, NOW)), id)!.tags, []);
      assert.deepEqual(findRally(ok(setTags(library, id, ['tough', 'work'], pro, NOW)), id)!.tags, ['tough', 'work'], 'reordering adds nothing');
      assert.equal(errorOf(setTags(library, id, ['work', 'craving'], pro, NOW)), 'proRequired', 'swapping one tag for another adds one');
      assert.equal(errorOf(setTags(library, id, ['Not ok'], pro, NOW)), 'invalidTags');

      const photoRemoved = ok(removePhoto(library, id, NOW));
      assert.equal(findRally(photoRemoved, id)!.photo, null);
      assert.equal(errorOf(beginReplacement(photoRemoved, id, { photo: { extension: 'jpg', width: 1, height: 1 } }, pro, NOW)), 'proRequired');
    }
    assert.equal(visibleRallies(library).length, 2);
  });

  test('after Pro ends, audio can be re-recorded only within the Free allowance of one, up to 30 seconds', () => {
    const one = saved(1, 'granted', { ...DRAFT, audio: { ...DRAFT.audio, durationMs: 58_000 } });
    const id = idFor(0);
    const replace = (library: PepLibrary, durationMs: number, pro: ProAccess) =>
      errorOf(beginReplacement(library, id, { audio: { ...DRAFT.audio, durationMs } }, pro, NOW));
    for (const pro of ['denied', 'checking'] as const) {
      assert.equal(replace(one, 30_000, pro), 'ok');
      assert.equal(replace(one, 30_500, pro), 'ok');
      assert.equal(replace(one, 30_501, pro), 'tooLong');
      assert.equal(replace(one, 45_000, pro), 'tooLong');
    }
    assert.equal(replace(one, 60_000, 'granted'), 'ok');

    const three = saved(3, 'granted');
    for (const pro of ['denied', 'checking'] as const) assert.equal(replace(three, 10_000, pro), 'limitReached', pro);
    assert.equal(replace(three, 60_000, 'granted'), 'ok', 'resubscribing allows it again');
    assert.equal(visibleRallies(three).length, 3, 'nothing is hidden');

    const pending = ok(beginCreate(one, idFor(7), DRAFT, 'granted', NOW));
    assert.equal(replace(pending, 10_000, 'denied'), 'limitReached', 'a recording being saved counts');
    const reduced = ok(beginDelete(ok(beginDelete(three, idFor(1), NOW)), idFor(2), NOW));
    assert.equal(replace(reduced, 30_000, 'denied'), 'ok', 'after deleting down to one');
    assert.equal(replace(reduced, 31_000, 'denied'), 'tooLong');
  });

  test('play, rename, photo removal and deletion take no subscription access at all', () => {
    const source = readFileSync(join(__dirname, '..', '..', 'src', 'pepRally', 'lifecycle.ts'), 'utf8');
    for (const name of ['rename', 'markPlayed', 'removePhoto', 'beginDelete', 'cancelDelete', 'forgetFiles', 'filesToDelete', 'beginReset']) {
      const signature = new RegExp(`export function ${name}\\(([^)]*)\\)`).exec(source);
      assert.ok(signature, name);
      assert.ok(!/ProAccess|pro\b/.test(signature[1]), `${name} must not depend on access`);
    }
  });
});

describe('Pep Rally lifecycle', () => {
  test('saving is two steps: pending until the audio is in place, then ready', () => {
    const begun = beginCreate(defaultPepLibrary(), idFor(1), DRAFT, 'denied', NOW);
    assert.ok(begun.ok);
    assert.equal(begun.rally?.status, 'pending');
    assert.equal(begun.rally?.audio.fileName, `${idFor(1)}-a1.m4a`);
    assert.equal(visibleRallies(begun.library).length, 0, 'not shown until saved');
    const completed = ok(completeCreate(begun.library, idFor(1), NOW));
    assert.equal(findRally(completed, idFor(1))?.status, 'ready');
    assert.equal(ok(completeCreate(completed, idFor(1), NOW)), completed, 'completing twice changes nothing');
    assert.deepEqual(abandonCreate(begun.library, idFor(1), NOW).rallies, []);
    assert.equal(abandonCreate(completed, idFor(1), NOW), completed, 'a saved rally is never abandoned');
  });

  test("someone else's voice needs their confirmed permission", () => {
    const draft: CreateDraft = { ...DRAFT, voice: 'someoneElse', source: 'import' };
    assert.equal(errorOf(beginCreate(defaultPepLibrary(), idFor(1), draft, 'granted', NOW)), 'consentRequired');
    const begun = beginCreate(defaultPepLibrary(), idFor(1), { ...draft, consentConfirmed: true }, 'granted', NOW);
    assert.ok(begun.ok);
    assert.equal(begun.rally?.consentConfirmedAt, NOW.toISOString());
    assert.equal(begun.rally?.source, 'import');
  });

  test('titles, tags and media are checked before anything is recorded', () => {
    const library = defaultPepLibrary();
    assert.equal(errorOf(beginCreate(library, idFor(1), { ...DRAFT, title: '  ' }, 'granted', NOW)), 'invalidTitle');
    assert.equal(errorOf(beginCreate(library, idFor(1), { ...DRAFT, tags: ['Not ok'] }, 'granted', NOW)), 'invalidTags');
    assert.equal(errorOf(beginCreate(library, idFor(1), { ...DRAFT, audio: { ...DRAFT.audio, extension: 'ogg' as never } }, 'granted', NOW)), 'invalidAudio');
    assert.equal(errorOf(beginCreate(library, 'bad-id', DRAFT, 'granted', NOW)), 'busy');
    assert.equal(errorOf(rename(saved(1, 'denied'), idFor(0), 'x'.repeat(41), NOW)), 'invalidTitle');
  });

  test('replacing media uses new file names and retires the old ones only once complete', () => {
    let library = saved(1, 'granted');
    const id = idFor(0);
    library = ok(beginReplacement(library, id, { audio: { ...DRAFT.audio, durationMs: 40_000 } }, 'granted', NOW));
    assert.equal(findRally(library, id)!.audio.fileName, `${id}-a1.m4a`, 'the old audio stays in use meanwhile');
    assert.equal(findRally(library, id)!.replacing?.audio?.fileName, `${id}-a2.m4a`);
    assert.equal(errorOf(beginReplacement(library, id, { audio: DRAFT.audio }, 'granted', NOW)), 'busy');
    assert.equal(errorOf(beginDelete(library, id, NOW)), 'busy');
    library = ok(completeReplacement(library, id, NOW));
    const rally = findRally(library, id)!;
    assert.equal(rally.audio.fileName, `${id}-a2.m4a`);
    assert.equal(rally.audio.durationMs, 40_000);
    assert.deepEqual(rally.retiredFiles, [`${id}-a1.m4a`]);

    library = ok(beginReplacement(library, id, { audio: DRAFT.audio }, 'granted', NOW));
    library = abandonReplacement(library, id, NOW);
    assert.equal(findRally(library, id)!.replacing, null);
    assert.deepEqual(findRally(library, id)!.retiredFiles, [`${id}-a1.m4a`, `${id}-a3.m4a`], 'a file that may have arrived is deleted too');
    library = ok(beginReplacement(library, id, { audio: DRAFT.audio }, 'granted', NOW));
    assert.equal(findRally(library, id)!.replacing?.audio?.fileName, `${id}-a4.m4a`, 'revisions are never reused');
  });

  test('deleting hides the rally at once and lists every one of its files', () => {
    const id = 'pr-mgabc123-k3j9x0qa';
    const library = libraryOf(
      storedRally(id, { photo: { fileName: `${id}-p2.jpg`, width: null, height: null }, retiredFiles: [`${id}-a2.m4a`], revision: 2 }),
      storedRally('pr-mgabc456-p0p0p0p0'),
    );
    const deleting = ok(beginDelete(library, id, NOW));
    assert.equal(visibleRallies(deleting).length, 1);
    assert.deepEqual(
      filesToDelete(deleting).map((file) => file.fileName),
      [`${id}-a1.m4a`, `${id}-p2.jpg`, `${id}-a2.m4a`],
    );
    assert.deepEqual(filesToDelete(deleting, new Set([id])), []);
    assert.equal(findRally(cancelDelete(deleting, id, NOW), id)?.status, 'ready');

    const partly = forgetFiles(deleting, new Set([`${id}-a1.m4a`]), NOW);
    assert.equal(findRally(partly, id)?.status, 'deleting', 'kept until every file is gone');
    const gone = forgetFiles(partly, new Set([`${id}-a1.m4a`, `${id}-p2.jpg`, `${id}-a2.m4a`]), NOW);
    assert.equal(findRally(gone, id), undefined);
    assert.equal(forgetFiles(deleting, new Set(filesToDelete(deleting).map((file) => file.fileName)), NOW, new Set([id])), deleting);
  });

  test('a reset marks every rally for deletion, including one still being saved', () => {
    const pending = ok(beginCreate(saved(1, 'granted'), idFor(5), DRAFT, 'granted', NOW));
    const reset = beginReset(pending, NOW);
    assert.ok(reset.rallies.every((rally) => rally.status === 'deleting'));
    assert.equal(beginReset(reset, new Date('2026-10-14T00:00:00Z')), reset);
    assert.equal(ok(completeCreate(reset, idFor(5), NOW)), reset, 'finishing a save never brings a deleted rally back');
  });

  test('a reset erases every detail at once, keeping only the file names still to be deleted', () => {
    const id = 'pr-mgabc123-k3j9x0qa';
    const rally = storedRally(id, {
      title: 'Mum, before work',
      voice: 'someoneElse',
      consentConfirmedAt: '2026-10-01T08:00:00.000Z',
      source: 'import',
      tags: ['work'],
      favorite: true,
      lastPlayedAt: '2026-10-02T08:00:00.000Z',
      photo: { fileName: `${id}-p2.jpg`, width: 800, height: 600 },
      revision: 3,
      replacing: { audio: { fileName: `${id}-a3.m4a`, durationMs: 9000, byteSize: 5 }, photo: null },
      retiredFiles: [`${id}-a2.m4a`],
    });
    const library = libraryOf({ ...rally, mood: 'calm' } as never);
    const [erased] = beginReset(library, NOW).rallies;
    assert.deepEqual(erased, {
      id,
      title: 'Pep Rally',
      status: 'deleting',
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      source: 'microphone',
      voice: 'mine',
      consentConfirmedAt: null,
      audio: { fileName: `${id}-a1.m4a`, durationMs: null, byteSize: null },
      photo: { fileName: `${id}-p2.jpg`, width: null, height: null },
      tags: [],
      favorite: false,
      lastPlayedAt: null,
      revision: 3,
      replacing: { audio: { fileName: `${id}-a3.m4a`, durationMs: null, byteSize: null }, photo: null },
      retiredFiles: [`${id}-a2.m4a`],
    });
    assert.deepEqual(filesToDelete(beginReset(library, NOW)).map((file) => file.fileName).sort(), filesOf(rally).sort());
  });
});

describe('Pep Rally recovery', () => {
  const id = 'pr-mgabc123-k3j9x0qa';
  const other = 'pr-mgabc456-p0p0p0p0';

  test('a save that reached its file step is finished; one that did not is undone', () => {
    const library = libraryOf(storedRally(id, { status: 'pending' }), storedRally(other, { status: 'pending' }));
    const { library: next, report } = recoverLibrary(library, [`${id}-a1.m4a`], NOW);
    assert.deepEqual(next.rallies.map((rally) => [rally.id, rally.status]), [[id, 'ready']]);
    assert.deepEqual(report.completed, [id]);
    assert.deepEqual(report.abandoned, [other]);
  });

  test('an interrupted replacement is finished if its file arrived, otherwise undone', () => {
    const replacing = (rallyId: string) =>
      storedRally(rallyId, { revision: 2, replacing: { audio: { fileName: `${rallyId}-a2.m4a`, durationMs: 9000, byteSize: null }, photo: null } });
    const library = libraryOf(replacing(id), replacing(other));
    const { library: next, report } = recoverLibrary(library, [`${id}-a1.m4a`, `${id}-a2.m4a`, `${other}-a1.m4a`], NOW);
    const finished = findRally(next, id)!;
    assert.equal(finished.audio.fileName, `${id}-a2.m4a`);
    assert.deepEqual(finished.retiredFiles, [`${id}-a1.m4a`]);
    const undone = findRally(next, other)!;
    assert.equal(undone.audio.fileName, `${other}-a1.m4a`);
    assert.equal(undone.replacing, null);
    assert.deepEqual(report.completed, [id]);
    assert.deepEqual(report.abandoned, [other]);
  });

  test('missing files are reported and the recording is kept; unlisted files are only reported', () => {
    const library = libraryOf(storedRally(id, { photo: { fileName: `${id}-p1.jpg`, width: null, height: null } }), storedRally(other));
    const { library: next, report } = recoverLibrary(library, [`${other}-a1.m4a`, 'pr-zz-zzzzzzzz-a1.m4a', 'notes.txt'], NOW);
    assert.equal(next, library, 'nothing about the library changes');
    assert.deepEqual(report.missingAudio, [id]);
    assert.deepEqual(report.missingPhoto, [id]);
    assert.deepEqual(report.unlisted, ['pr-zz-zzzzzzzz-a1.m4a', 'notes.txt']);
  });
});
