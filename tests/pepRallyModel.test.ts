import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isPreserved } from '../src/data/preserve';
import { isSafeRecordingFileName } from '../src/data/recordings';
import {
  isMediaOf,
  isPepDirectoryUri,
  isPepMediaFileName,
  isPepRallyId,
  isStagedFileName,
  mediaFileName,
  newPepRallyId,
  parseMediaFileName,
  PEP_MEDIA_DIRECTORY,
  PEP_STAGING_DIRECTORY,
  stagedFileName,
} from '../src/pepRally/files';
import {
  DEFAULT_PEP_TITLE,
  defaultPepLibrary,
  filesOf,
  isNewerLibrary,
  normalizeTags,
  normalizeTitle,
  PEP_LIBRARY_VERSION,
  PepRally,
  sanitizePepLibrary,
  visibleRallies,
} from '../src/pepRally/model';
import { LIBRARY_URI, libraryOf, STAGING_URI, storedRally } from './pepRally/fakes';

const A = 'pr-mgabc123-k3j9x0qa';
const B = 'pr-mgabc456-p0p0p0p0';

describe('Pep Rally ids and media names', () => {
  test('ids are stable, unique and follow one pattern', () => {
    const at = new Date('2026-10-13T08:00:00.000Z');
    const ids = new Set(Array.from({ length: 500 }, () => newPepRallyId(at)));
    assert.equal(ids.size, 500);
    for (const id of ids) assert.ok(isPepRallyId(id), id);
    const seeded = () => {
      let seed = 0;
      return () => (seed = (seed + 7) % 36) / 36;
    };
    assert.equal(newPepRallyId(at, seeded()), newPepRallyId(at, seeded()));
    for (const bad of ['', 'pr-x', 'PR-abc-12345678', 'pr-abc-1234567', 'pr-abc-12345678/..', '../pr-abc-12345678', 7]) {
      assert.equal(isPepRallyId(bad), false, String(bad));
    }
  });

  test('media file names come only from the rally id, kind and revision', () => {
    const audio = mediaFileName(A, 'audio', 3, 'm4a');
    const photo = mediaFileName(A, 'photo', 4, 'jpg');
    assert.equal(audio, `${A}-a3.m4a`);
    assert.deepEqual(parseMediaFileName(audio), { owner: A, kind: 'audio', revision: 3 });
    assert.deepEqual(parseMediaFileName(photo), { owner: A, kind: 'photo', revision: 4 });
    assert.ok(isMediaOf(A, 'audio', audio) && !isMediaOf(B, 'audio', audio) && !isMediaOf(A, 'photo', audio));
    for (const bad of [
      `${A}-a0.m4a`,
      `${A}-a1.jpg`,
      `${A}-p1.m4a`,
      `${A}-a1.M4A`,
      `${A}-a1.txt`,
      `../${A}-a1.m4a`,
      `${A}-a1.m4a/`,
      `sub/${A}-a1.m4a`,
      `${A}-a1`,
      'notes.m4a',
    ]) {
      assert.equal(isPepMediaFileName(bad), false, bad);
    }
  });

  test('every generated name passes the shared recording deletion rule', () => {
    for (const name of [mediaFileName(A, 'audio', 1, 'm4a'), mediaFileName(A, 'audio', 2, 'aiff'), mediaFileName(A, 'photo', 2, 'heic')]) {
      assert.ok(isSafeRecordingFileName(name), name);
    }
    assert.ok(isSafeRecordingFileName(stagedFileName('take1', 'm4a')));
    assert.ok(isStagedFileName(stagedFileName('take1', 'jpg')));
    for (const bad of ['stage-.m4a', 'stage-x.txt', 'stage-../x.m4a', 'x.m4a']) assert.equal(isStagedFileName(bad), false, bad);
  });

  test("only Puphii's own two folders are accepted as media folders", () => {
    assert.ok(isPepDirectoryUri(LIBRARY_URI, PEP_MEDIA_DIRECTORY));
    assert.ok(isPepDirectoryUri(STAGING_URI, PEP_STAGING_DIRECTORY));
    for (const bad of [
      'file:///var/mobile/Documents/',
      'file:///pep-rallies/',
      'file:///var/mobile/Documents/pep-rallies',
      'file:///var/mobile/../Documents/pep-rallies/',
      'file:///var/mobile/./pep-rallies/',
      'file:///var/mobile//pep-rallies/',
      'file:///var/mobile/%2E%2E/pep-rallies/',
      'file:///var/mobile/pep-rallies-old/',
      'https://example.com/pep-rallies/',
      '/var/mobile/pep-rallies/',
      null,
    ]) {
      assert.equal(isPepDirectoryUri(bad, PEP_MEDIA_DIRECTORY), false, String(bad));
    }
    assert.equal(isPepDirectoryUri(LIBRARY_URI, PEP_STAGING_DIRECTORY), false);
  });
});

describe('Pep Rally library model', () => {
  test('a missing or unusable library is empty and versioned', () => {
    for (const raw of [null, undefined, 'x', 7, [1]]) assert.deepEqual(sanitizePepLibrary(raw), defaultPepLibrary());
    assert.equal(defaultPepLibrary().version, PEP_LIBRARY_VERSION);
  });

  test('a valid library is restored exactly, with fields from other versions kept', () => {
    const base = storedRally(A, { photo: { fileName: `${A}-p1.jpg`, width: 800, height: 600 }, tags: ['craving', 'commute'], favorite: true });
    const first = { ...base, mood: 'x', audio: { ...base.audio, codec: 'aac' } } as PepRally;
    const raw = {
      ...libraryOf(first, storedRally(B, { voice: 'someoneElse', consentConfirmedAt: '2026-10-02T08:00:00.000Z', source: 'import' })),
      sortOrder: 'newest',
    };
    const restored = sanitizePepLibrary(JSON.parse(JSON.stringify(raw)));
    assert.ok(isPreserved(raw, restored));
    assert.deepEqual(restored, raw);
    assert.deepEqual(restored.rallies[0].tags, ['craving', 'commute'], 'tags from newer versions are kept');
  });

  test('an entry is dropped only when its id or audio name could point at the wrong file', () => {
    const restored = sanitizePepLibrary(
      libraryOf(
        storedRally(A),
        { ...storedRally(B), audio: { fileName: '../Documents/notes.m4a', durationMs: 1000, byteSize: 1 } },
        { ...storedRally('pr-mgabc789-zzzzzzzz'), audio: { fileName: `${A}-a2.m4a`, durationMs: 1000, byteSize: 1 } },
        { ...storedRally(A), title: 'Duplicate id' },
        { ...storedRally('not-an-id') },
      ),
    );
    assert.deepEqual(restored.rallies.map((rally) => rally.id), [A]);
  });

  test('two entries can never share a file, so deleting one never removes the other’s media', () => {
    const claimant = storedRally(B, {
      photo: { fileName: `${A}-p1.jpg`, width: null, height: null },
      replacing: { audio: { fileName: `${A}-a2.m4a`, durationMs: 1000, byteSize: null }, photo: null },
      retiredFiles: [`${A}-a1.m4a`],
    });
    const restored = sanitizePepLibrary(libraryOf(storedRally(A, { photo: { fileName: `${A}-p1.jpg`, width: null, height: null } }), claimant));
    assert.equal(restored.rallies.length, 2);
    assert.deepEqual(filesOf(restored.rallies[1]), [`${B}-a1.m4a`]);
    const names = restored.rallies.flatMap(filesOf);
    assert.equal(new Set(names).size, names.length);
  });

  test('other problems are repaired instead of losing the recording', () => {
    const [rally] = sanitizePepLibrary(
      libraryOf({
        ...storedRally(A),
        title: '   ',
        status: 'archived' as never,
        source: 'radio' as never,
        voice: 7 as never,
        favorite: 'yes' as never,
        tags: ['craving', 'craving', 'Not A Tag', 4, 'tough'] as never,
        audio: { fileName: `${A}-a5.m4a`, durationMs: 90_000, byteSize: -1 },
        photo: { fileName: `${B}-p1.jpg`, width: 1, height: 1 },
        revision: 2,
        retiredFiles: [`${A}-a1.m4a`, `${B}-a1.m4a`, `${A}-a5.m4a`, '../x.m4a'],
        createdAt: 'yesterday',
      }),
    ).rallies;
    assert.equal(rally.title, DEFAULT_PEP_TITLE);
    assert.equal(rally.status, 'ready');
    assert.equal(rally.source, 'microphone');
    assert.equal(rally.voice, 'mine');
    assert.equal(rally.favorite, false);
    assert.deepEqual(rally.tags, ['craving', 'tough']);
    assert.deepEqual(rally.audio, { fileName: `${A}-a5.m4a`, durationMs: null, byteSize: null });
    assert.equal(rally.photo, null, "another rally's photo is never adopted");
    assert.equal(rally.revision, 5, 'a revision is never lower than a name already used');
    assert.deepEqual(rally.retiredFiles, [`${A}-a1.m4a`]);
    assert.equal(rally.createdAt, rally.updatedAt);
  });

  test('a replacement that would reuse a file in use is dropped', () => {
    const [rally] = sanitizePepLibrary(
      libraryOf(storedRally(A, { replacing: { audio: { fileName: `${A}-a1.m4a`, durationMs: 1000, byteSize: null }, photo: null } })),
    ).rallies;
    assert.equal(rally.replacing, null);
  });

  test('a library written by a newer Puphii keeps its version and is marked as newer', () => {
    const restored = sanitizePepLibrary({ ...libraryOf(storedRally(A)), version: 3 });
    assert.equal(restored.version, 3);
    assert.ok(isNewerLibrary(restored));
    assert.equal(isNewerLibrary(sanitizePepLibrary(libraryOf())), false);
  });

  test('only saved rallies are visible', () => {
    const library = libraryOf(storedRally(A), storedRally(B, { status: 'deleting' }), storedRally('pr-mgabc789-zzzzzzzz', { status: 'pending' }));
    assert.deepEqual(visibleRallies(library).map((rally) => rally.id), [A]);
  });

  test('titles and tags are checked the same way everywhere', () => {
    assert.equal(normalizeTitle('  Before work  '), 'Before work');
    assert.equal(normalizeTitle('あ'.repeat(40)), 'あ'.repeat(40));
    for (const bad of ['', '   ', 'x'.repeat(41), 'line\nbreak', 3, null]) assert.equal(normalizeTitle(bad), null, String(bad));
    assert.deepEqual(normalizeTags(['craving', 'craving', 'work']), ['craving', 'work']);
    assert.equal(normalizeTags(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']), null);
    assert.equal(normalizeTags(['Bad tag']), null);
  });
});
