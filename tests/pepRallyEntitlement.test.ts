import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { PepActionResult, PepTakeResult } from '../src/data/pepRallyController';
import { maxDurationFor, PEP_ACCESS, PepAccess, pepAccessFor } from '../src/pepRally/access';
import { AudioDraft, beginCreate, beginDelete, beginReplacement, completeCreate, CreateDraft, markPlayed, PepResult, rename, setFavorite, setTags } from '../src/pepRally/lifecycle';
import { defaultPepLibrary, PepLibrary, visibleRallies } from '../src/pepRally/model';
import {
  LEGAL_URLS,
  PAYWALL_OFFERING_ID,
  PLANS,
  PRO_FEATURE_BENEFITS,
  REVENUECAT_ENTITLEMENT_ID,
  SUBSCRIPTION_GATING_ENABLED,
  TEST_STORE_PRODUCT_IDS,
} from '../src/subscription/config';
import { accessFor, Entitlement, ProAccess } from '../src/subscription/entitlement';
import { showPaywallEntry } from '../src/subscription/paywall';
import { proGatingActive } from '../src/subscription/proFeatures';
import { MemoryStore } from './plan/storeHarness';
import { cloneStore, DRAFT, KEY, libraryOf, MemoryMedia, NOW, pepApp, storedRally } from './pepRally/fakes';

const STORE = { origin: 'store', verifiedAt: NOW.toISOString() } as const;
const LATER = '2026-11-13T08:00:00.000Z';
const ENTITLEMENTS = {
  unknown: { status: 'unknown' },
  error: { status: 'error', error: { kind: 'network', message: 'offline' } },
  neverSubscribed: { status: 'inactive', reason: 'neverSubscribed', lastPlan: null, annualTrial: 'eligible', verification: STORE },
  trial: { status: 'active', plan: 'annual', period: 'trial', expiresAt: LATER, willRenew: true, verification: STORE },
  paid: { status: 'active', plan: 'monthly', period: 'paid', expiresAt: LATER, willRenew: true, verification: STORE },
  mockPaid: { status: 'active', plan: 'monthly', period: 'paid', expiresAt: LATER, willRenew: true, verification: { ...STORE, origin: 'mock' } },
  gracePeriod: { status: 'gracePeriod', plan: 'monthly', expiresAt: LATER, verification: STORE },
  billingRetry: { status: 'billingRetry', plan: 'monthly', verification: STORE },
  expired: { status: 'inactive', reason: 'expired', lastPlan: 'monthly', annualTrial: 'ineligible', verification: STORE },
  trialEnded: { status: 'inactive', reason: 'expired', lastPlan: 'annual', annualTrial: 'ineligible', verification: STORE },
} satisfies Record<string, Entitlement>;
type EntitlementName = keyof typeof ENTITLEMENTS;

/** Pep Rally access exactly as a release build with the paywall shown would work it out. */
const pepFor = (name: EntitlementName): PepAccess =>
  pepAccessFor(accessFor(ENTITLEMENTS[name], { gatingEnabled: true, allowMock: false }).pro, true);

/** `error`, or `error/upsell` when something is offered. */
const outcome = (result: PepResult | PepActionResult | PepTakeResult): string =>
  result.ok ? 'ok' : result.upsell ? `${result.error}/${result.upsell}` : result.error;

let sequence = 0;
const nextId = () => `pr-${(sequence++).toString(36)}-entitled`;
const audio = (durationMs: number): AudioDraft => ({ ...DRAFT.audio, durationMs });
const draft = (durationMs = 20_000, extra: Partial<CreateDraft> = {}): CreateDraft => ({ ...DRAFT, ...extra, audio: audio(durationMs) });
const PHOTO = { photo: { extension: 'jpg', width: 800, height: 800 } } as const;

function create(library: PepLibrary, access: PepAccess, recording: CreateDraft = draft()): PepResult {
  return beginCreate(library, nextId(), recording, access, NOW);
}

function saveAll(library: PepLibrary, access: PepAccess, count: number, recording: CreateDraft = draft()): PepLibrary {
  for (let n = 0; n < count; n += 1) {
    const id = nextId();
    const begun = beginCreate(library, id, recording, access, NOW);
    assert.ok(begun.ok, outcome(begun));
    const completed = completeCreate(begun.library, id, NOW);
    assert.ok(completed.ok);
    library = completed.library;
  }
  return library;
}

const ok = (result: PepResult): PepLibrary => {
  assert.ok(result.ok, outcome(result));
  return result.library;
};

/** Every Pro-dependent action, tried on one rally the person could still add something to. */
function probe(library: PepLibrary, access: PepAccess): Record<string, string> {
  const rallies = visibleRallies(library);
  const target = rallies.find((rally) => !rally.favorite && !rally.photo) ?? rallies[0];
  const results: Record<string, string> = {
    create: outcome(create(library, access)),
    createLong: outcome(create(library, access, draft(45_000))),
    createTagged: outcome(create(library, access, draft(20_000, { tags: ['craving'] }))),
  };
  if (target) {
    results.reRecord = outcome(beginReplacement(library, target.id, { audio: audio(20_000) }, access, NOW));
    results.reRecordLong = outcome(beginReplacement(library, target.id, { audio: audio(45_000) }, access, NOW));
    results.photo = outcome(beginReplacement(library, target.id, PHOTO, access, NOW));
    results.tag = outcome(setTags(library, target.id, [...target.tags, 'celebrate'], access, NOW));
    results.favorite = outcome(setFavorite(library, target.id, true, access, NOW));
  }
  return results;
}

/** Saves through the controller from a newly staged take. */
let takeNumber = 0;
async function record(app: ReturnType<typeof pepApp>, recording: CreateDraft = draft()) {
  return app.controller.create(recording, app.media!.stage(`take${takeNumber++}`));
}

async function launched(initial: Record<string, unknown> = {}) {
  const store = new MemoryStore(initial);
  const media = new MemoryMedia();
  const app = pepApp(store, media);
  await app.launch();
  return { app, store, media };
}

const fullLibrary = (count: number) => libraryOf(...Array.from({ length: count }, (_, n) => storedRally(`pr-${n.toString(36)}-fulllibr`)));

describe('Pep Rallies through Free, Pro, expiry and renewal', () => {
  test('Free: the first recording saves up to 30 seconds; another, a longer one or Pro extras offer an upgrade', () => {
    const free = pepFor('neverSubscribed');
    assert.equal(free, 'free');
    let library = defaultPepLibrary();
    assert.equal(outcome(create(library, free, draft(31_000))), 'tooLong/upgrade');
    assert.equal(outcome(create(library, free, draft(20_000, { tags: ['craving'] }))), 'proRequired/upgrade');
    assert.equal(outcome(create(library, free, draft(20_000, { favorite: true }))), 'proRequired/upgrade');
    library = saveAll(library, free, 1, draft(30_000));
    assert.equal(outcome(create(library, free)), 'limitReached/upgrade');
    const [rally] = visibleRallies(library);
    assert.equal(outcome(beginReplacement(library, rally.id, PHOTO, free, NOW)), 'proRequired/upgrade');
    assert.equal(outcome(setTags(library, rally.id, ['work'], free, NOW)), 'proRequired/upgrade');
    assert.equal(outcome(setFavorite(library, rally.id, true, free, NOW)), 'proRequired/upgrade');
  });

  test('Free to Pro on the same library: up to 50 at 60 seconds with extras, then the library is full with no offer', () => {
    let library = saveAll(defaultPepLibrary(), pepFor('neverSubscribed'), 1);
    const pro = pepFor('paid');
    assert.equal(pro, 'pro');
    const [first] = visibleRallies(library);
    library = ok(beginReplacement(library, first.id, PHOTO, pro, NOW));
    assert.equal(outcome(create(library, pro, draft(61_000))), 'tooLong', 'too long for Pro offers nothing');
    library = saveAll(library, pro, 49, draft(60_000, { tags: ['work'], favorite: true }));
    assert.equal(visibleRallies(library).length, 50);
    assert.equal(outcome(create(library, pro)), 'libraryFull');
  });

  test('Pro to expired: the library is unchanged, and play, rename, delete and every removal still work', async () => {
    const { app, store, media } = await launched();
    app.access.current = pepFor('paid');
    for (let n = 0; n < 5; n += 1) assert.ok((await record(app, draft(58_000, { tags: ['work', 'tough'], favorite: true }))).ok);
    const [id, other] = visibleRallies(app.controller.current()).map((rally) => rally.id);
    assert.ok((await app.controller.replace(id, PHOTO, { photo: media.stage('pic', 'jpg') })).ok);
    const before = structuredClone(app.controller.current());
    const storedBefore = store.data.get(KEY);

    app.access.current = pepFor('expired');
    await app.controller.flush();
    assert.deepEqual(app.controller.current(), before, 'expiry alone changes nothing');
    assert.equal(store.data.get(KEY), storedBefore);

    assert.ok(app.controller.markPlayed(id).ok);
    assert.ok(app.controller.rename(id, 'Still mine').ok);
    assert.ok(app.controller.setFavorite(id, false).ok);
    assert.ok(app.controller.setTags(id, ['work']).ok);
    assert.ok((await app.controller.removePhoto(id)).ok);
    assert.ok((await app.controller.delete(other)).ok);
    assert.equal(visibleRallies(app.controller.current()).length, 4);
  });

  test('expired: new recordings, photos, tags, favorites and re-recording are refused with an offer to resubscribe', () => {
    let library = saveAll(defaultPepLibrary(), pepFor('paid'), 3);
    const expired = pepFor('expired');
    assert.equal(expired, 'free');
    const [rally] = visibleRallies(library);
    assert.equal(outcome(create(library, expired)), 'limitReached/resubscribe');
    assert.equal(outcome(beginReplacement(library, rally.id, PHOTO, expired, NOW)), 'proRequired/resubscribe');
    assert.equal(outcome(setTags(library, rally.id, ['work'], expired, NOW)), 'proRequired/resubscribe');
    assert.equal(outcome(setFavorite(library, rally.id, true, expired, NOW)), 'proRequired/resubscribe');
    assert.equal(outcome(beginReplacement(library, rally.id, { audio: audio(10_000) }, expired, NOW)), 'limitReached/resubscribe');
    library = ok(rename(library, rally.id, 'Kept', NOW));
    assert.equal(visibleRallies(library).length, 3, 'nothing is hidden');
  });

  test('expired: after deleting down to one, re-recording works up to 30 seconds and not beyond', () => {
    let library = saveAll(defaultPepLibrary(), pepFor('paid'), 3);
    const expired = pepFor('expired');
    const [keep, ...rest] = visibleRallies(library).map((rally) => rally.id);
    for (const id of rest) library = ok(beginDelete(library, id, NOW));
    assert.equal(outcome(beginReplacement(library, keep, { audio: audio(30_000) }, expired, NOW)), 'ok');
    assert.equal(outcome(beginReplacement(library, keep, { audio: audio(31_000) }, expired, NOW)), 'tooLong/upgrade');
  });

  test('expired to renewed: every Pro action works at once on the same library, and the 50 limit counts what is there', () => {
    const library = saveAll(defaultPepLibrary(), pepFor('paid'), 5);
    assert.ok(Object.values(probe(library, pepFor('expired'))).some((result) => result.endsWith('/resubscribe')));
    const renewed = probe(library, pepFor('paid'));
    assert.deepEqual(renewed, {
      create: 'ok',
      createLong: 'ok',
      createTagged: 'ok',
      reRecord: 'ok',
      reRecordLong: 'ok',
      photo: 'ok',
      tag: 'ok',
      favorite: 'ok',
    });
    const full = saveAll(defaultPepLibrary(), pepFor('paid'), 50);
    assert.equal(outcome(create(full, pepFor('expired'))), 'limitReached/resubscribe');
    assert.equal(outcome(create(full, pepFor('paid'))), 'libraryFull');
  });

  test('a trial that ends without a purchase follows exactly the expired path', () => {
    assert.equal(pepFor('trial'), 'pro');
    const library = saveAll(defaultPepLibrary(), pepFor('trial'), 3, draft(50_000, { tags: ['morning'] }));
    assert.equal(pepFor('trialEnded'), 'free');
    assert.deepEqual(probe(library, pepFor('trialEnded')), probe(library, pepFor('expired')));
    assert.equal(outcome(create(library, pepFor('trialEnded'))), 'limitReached/resubscribe');
  });

  test('a billing grace period is Pro; billing retry is expired; an unverified mock entitlement is never Pro in a release build', () => {
    const library = saveAll(defaultPepLibrary(), pepFor('paid'), 3);
    assert.equal(pepFor('gracePeriod'), 'pro');
    assert.deepEqual(probe(library, pepFor('gracePeriod')), probe(library, pepFor('paid')));
    assert.equal(pepFor('billingRetry'), 'free');
    assert.deepEqual(probe(library, pepFor('billingRetry')), probe(library, pepFor('expired')));
    assert.equal(pepFor('mockPaid'), 'free');
  });

  test('the stored library never records a tier, entitlement, expiry or allowance', async () => {
    const { app, store, media } = await launched();
    app.access.current = 'pro';
    const take = media.stage('allowed');
    assert.ok(app.controller.openTake(take).ok);
    app.access.current = 'free';
    assert.ok((await app.controller.create(draft(55_000, { tags: ['work'], favorite: true }), take)).ok);
    await app.controller.releaseTake(take);
    await app.controller.flush();
    const keys = new Set<string>();
    const collect = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === 'object') {
        for (const [key, inner] of Object.entries(value)) {
          keys.add(key);
          collect(inner);
        }
      }
    };
    collect(JSON.parse(store.data.get(KEY)!));
    for (const key of keys) assert.ok(!/tier|entitle|expir|allowance|access|subscri|^pro$|plan/i.test(key), key);
  });

  test('answers depend only on the access at the moment of asking, never on how it got there', async () => {
    let seed = 7;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const initial = { [KEY]: libraryOf(storedRally('pr-a-pathtest'), storedRally('pr-b-pathtest')) };
    const answers = async (path: PepAccess[]) => {
      const { app } = await launched(initial);
      for (const step of path) {
        app.access.current = step;
        app.controller.setFavorite('pr-a-pathtest', false);
      }
      return [
        outcome(app.controller.setTags('pr-a-pathtest', ['celebrate'])),
        outcome(app.controller.setFavorite('pr-b-pathtest', true)),
        outcome(await record(app, draft(45_000))),
      ];
    };
    for (let run = 0; run < 40; run += 1) {
      const path = Array.from({ length: 1 + Math.floor(random() * 6) }, () => PEP_ACCESS[Math.floor(random() * PEP_ACCESS.length)]);
      assert.deepEqual(await answers(path), await answers([path[path.length - 1]]), path.join(' > '));
    }
  });
});

describe('Pep Rallies while subscription status is still being checked', () => {
  test('with 10 saved, a new recording answers checking: never a limit and never an offer', () => {
    const library = saveAll(defaultPepLibrary(), pepFor('paid'), 10);
    assert.equal(outcome(create(library, pepFor('unknown'))), 'checking');
  });

  test('with nothing saved, starting a recording answers checking, because its length depends on the tier', () => {
    assert.equal(outcome(create(defaultPepLibrary(), 'checking')), 'checking');
    assert.equal(maxDurationFor('checking'), null);
    assert.equal(maxDurationFor('unavailable'), null);
  });

  test('adding a photo, a tag or a favorite answers checking', () => {
    const library = saveAll(defaultPepLibrary(), 'free', 1);
    const [rally] = visibleRallies(library);
    assert.equal(outcome(beginReplacement(library, rally.id, PHOTO, 'checking', NOW)), 'checking');
    assert.equal(outcome(setTags(library, rally.id, ['work'], 'checking', NOW)), 'checking');
    assert.equal(outcome(setFavorite(library, rally.id, true, 'checking', NOW)), 'checking');
  });

  test('play, rename, delete and every removal work while checking', async () => {
    const id = 'pr-a-checking';
    const rally = storedRally(id, { tags: ['work'], favorite: true, photo: { fileName: `${id}-p1.jpg`, width: 1, height: 1 } });
    const { app, media } = await launched({ [KEY]: libraryOf(rally, storedRally('pr-b-checking')) });
    media.library.set(`${id}-a1.m4a`, 'x').set(`${id}-p1.jpg`, 'x');
    app.access.current = 'checking';
    assert.ok(app.controller.markPlayed(id).ok);
    assert.ok(app.controller.rename(id, 'Waiting').ok);
    assert.ok(app.controller.setFavorite(id, false).ok);
    assert.ok(app.controller.setTags(id, []).ok);
    assert.ok((await app.controller.removePhoto(id)).ok);
    assert.ok((await app.controller.delete('pr-b-checking')).ok);
  });

  test('an error before any successful check counts as checking, like not having checked yet', () => {
    assert.equal(pepFor('error'), 'checking');
    assert.equal(pepFor('unknown'), 'checking');
    const library = saveAll(defaultPepLibrary(), 'free', 1);
    assert.deepEqual(probe(library, pepFor('error')), probe(library, pepFor('unknown')));
  });

  test('once checking turns into Pro, the same action succeeds without reloading anything', async () => {
    const { app } = await launched({ [KEY]: libraryOf(storedRally('pr-a-thenpro1')) });
    app.access.current = 'checking';
    assert.equal(outcome(await record(app, draft(50_000))), 'checking');
    assert.equal(outcome(app.controller.setFavorite('pr-a-thenpro1', true)), 'checking');
    app.access.current = 'pro';
    assert.equal(outcome(await record(app, draft(50_000))), 'ok');
    assert.equal(outcome(app.controller.setFavorite('pr-a-thenpro1', true)), 'ok');
  });

  test('nothing is ever offered unless access is verified Free', () => {
    const libraries = [
      defaultPepLibrary(),
      saveAll(defaultPepLibrary(), 'free', 1),
      saveAll(defaultPepLibrary(), 'pro', 3, draft(55_000, { tags: ['work'], favorite: true })),
      saveAll(defaultPepLibrary(), 'pro', 50),
    ];
    let offers = 0;
    for (const library of libraries) {
      for (const access of PEP_ACCESS) {
        for (const [action, result] of Object.entries(probe(library, access))) {
          const offered = result.includes('/');
          offers += offered ? 1 : 0;
          if (offered) assert.equal(access, 'free', `${action}: ${result}`);
          if (access === 'checking' || access === 'unavailable') assert.ok(result === access || result === 'ok', `${action}: ${result}`);
        }
      }
    }
    assert.ok(offers > 0);
  });
});

describe('Pep Rally access guards', () => {
  test('when subscription enforcement is off, Pep Rallies stay unavailable for new adds', () => {
    for (const pro of ['granted', 'denied', 'checking'] as ProAccess[]) assert.equal(pepAccessFor(pro, false), 'unavailable');
    const enforced = proGatingActive({ enabled: SUBSCRIPTION_GATING_ENABLED });
    assert.equal(enforced, true);
    assert.equal(accessFor(ENTITLEMENTS.neverSubscribed, { gatingEnabled: enforced, allowMock: false }).pro, 'denied');

    const library = saveAll(defaultPepLibrary(), 'free', 1);
    const results = probe(library, 'unavailable');
    assert.deepEqual(new Set(Object.values(results)), new Set(['unavailable']), JSON.stringify(results));
    const [rally] = visibleRallies(library);
    assert.ok(markPlayed(library, rally.id, NOW).ok);
    assert.ok(rename(library, rally.id, 'Mine', NOW).ok);
    assert.ok(beginDelete(library, rally.id, NOW).ok);
  });

  test('global Pro access and gating work exactly as before', () => {
    const table: [EntitlementName, ProAccess, ProAccess][] = [
      ['unknown', 'checking', 'checking'],
      ['error', 'checking', 'checking'],
      ['neverSubscribed', 'denied', 'denied'],
      ['trial', 'granted', 'granted'],
      ['paid', 'granted', 'granted'],
      ['mockPaid', 'denied', 'granted'],
      ['gracePeriod', 'granted', 'granted'],
      ['billingRetry', 'denied', 'denied'],
      ['expired', 'denied', 'denied'],
      ['trialEnded', 'denied', 'denied'],
    ];
    for (const [name, release, withMock] of table) {
      assert.equal(accessFor(ENTITLEMENTS[name], { gatingEnabled: true, allowMock: false }).pro, release, name);
      assert.equal(accessFor(ENTITLEMENTS[name], { gatingEnabled: true, allowMock: true }).pro, withMock, name);
      assert.equal(accessFor(ENTITLEMENTS[name], { gatingEnabled: false, allowMock: false }).pro, 'granted', name);
    }
    for (const enabled of [true, false]) {
      for (const paywallAvailable of [true, false]) {
        for (const storeReady of [true, false]) {
          assert.equal(proGatingActive({ enabled, paywallAvailable, storeReady }), enabled);
        }
      }
    }
  });

  test('subscription configuration is unchanged', () => {
    assert.equal(SUBSCRIPTION_GATING_ENABLED, true);
    assert.equal(REVENUECAT_ENTITLEMENT_ID, 'puphii_pro');
    assert.equal(PAYWALL_OFFERING_ID, 'default_v2');
    assert.deepEqual(LEGAL_URLS, { termsOfUse: null, privacyPolicy: null });
    assert.deepEqual(
      Object.fromEntries(Object.entries(PLANS).map(([plan, config]) => [plan, config.productIds.ios])),
      { annual: 'puphii_annual_2999', monthly: 'puphii_monthly_499', weekly: 'puphii_weekly_199' },
    );
    assert.deepEqual(TEST_STORE_PRODUCT_IDS, { annual: 'yearly_2999', monthly: 'monthly_499', weekly: 'weekly_199' });
    assert.deepEqual(Object.keys(PRO_FEATURE_BENEFITS), []);
  });
});

describe('Pep Rally access is read when an action runs', () => {
  test('a change of access applies to the very next call; a missing or broken source counts as checking', async () => {
    const { app } = await launched({ [KEY]: libraryOf(storedRally('pr-a-liveread')) });
    app.access.current = 'free';
    assert.equal(outcome(app.controller.setFavorite('pr-a-liveread', true)), 'proRequired/upgrade');
    app.access.current = 'pro';
    assert.equal(outcome(app.controller.setFavorite('pr-a-liveread', true)), 'ok');
    assert.equal(outcome(app.controller.setTags('pr-a-liveread', ['work'])), 'ok');

    app.controller.connectAccess(() => 'free');
    assert.equal(outcome(app.controller.setTags('pr-a-liveread', ['work', 'tough'])), 'proRequired/resubscribe');
    app.controller.connectAccess(null);
    assert.equal(outcome(await record(app)), 'checking');
    app.controller.connectAccess(() => 'granted' as unknown as PepAccess);
    assert.equal(outcome(await record(app)), 'checking', 'a global answer passed by mistake is not Pep Rally access');
    app.controller.connectAccess(() => {
      throw new Error('provider gone');
    });
    assert.equal(outcome(await record(app)), 'checking');
  });

  test('no action accepts access from the caller', async () => {
    const { app } = await launched({ [KEY]: libraryOf(storedRally('pr-a-nocaller'), storedRally('pr-b-nocaller')) });
    const { controller } = app;
    assert.deepEqual([controller.create.length, controller.replace.length, controller.setTags.length, controller.setFavorite.length], [2, 3, 2, 2]);
    app.access.current = 'free';
    const loose = controller as unknown as Record<string, (...args: unknown[]) => PepActionResult | Promise<PepActionResult>>;
    assert.equal(outcome(await loose.setFavorite('pr-a-nocaller', true, 'pro')), 'proRequired/resubscribe');
    assert.equal(outcome(await loose.setTags('pr-a-nocaller', ['work'], 'granted')), 'proRequired/resubscribe');
    assert.equal(outcome(await loose.create(draft(55_000), app.media!.stage('stale'), 'pro')), 'limitReached/resubscribe');
  });
});

describe('A recording started with verified Pro', () => {
  test('saves with Pro limits even if Pro ends or turns to checking meanwhile, but never past the 50', async () => {
    const { app, media } = await launched();
    for (const later of ['free', 'checking'] as const) {
      app.access.current = 'pro';
      const take = media.stage(`started${later}`);
      assert.deepEqual(app.controller.openTake(take), { ok: true, maxDurationMs: 60_000 });
      app.access.current = later;
      assert.equal(outcome(await app.controller.create(draft(58_000, { tags: ['work'] }), take)), 'ok', later);
      await app.controller.releaseTake(take);
    }
    assert.equal(visibleRallies(app.controller.current()).length, 2);

    app.access.current = 'pro';
    const hidden = media.stage('hidden');
    assert.ok(app.controller.openTake(hidden).ok);
    app.access.current = 'unavailable';
    assert.equal(outcome(await app.controller.create(draft(20_000), hidden)), 'unavailable', 'a hidden paywall always wins');

    const full = await launched({ [KEY]: fullLibrary(50) });
    full.app.access.current = 'pro';
    assert.deepEqual(full.app.controller.openTake(full.media.stage('fifty')), { ok: false, error: 'libraryFull' }, 'no recording starts');

    const almost = await launched({ [KEY]: fullLibrary(49) });
    almost.app.access.current = 'pro';
    const last = almost.media.stage('last');
    assert.ok(almost.app.controller.openTake(last).ok);
    assert.ok((await record(almost.app)).ok, 'something else fills the 50th place meanwhile');
    almost.app.access.current = 'free';
    assert.equal(outcome(await almost.app.controller.create(draft(20_000), last)), 'libraryFull');
  });

  test('covers one attempt only: it is used up by a failed save, a successful save or cancelling', async () => {
    const { app, media } = await launched();
    app.access.current = 'pro';
    const failing = media.stage('failing');
    assert.ok(app.controller.openTake(failing).ok);
    app.access.current = 'free';
    assert.equal(outcome(await app.controller.create(draft(58_000, { title: ' ' }), failing)), 'invalidTitle');
    assert.equal(outcome(await app.controller.create(draft(58_000), failing)), 'tooLong/upgrade', 'a retry gets current access');
    await app.controller.releaseTake(failing);

    app.access.current = 'pro';
    const saving = media.stage('saving');
    assert.ok(app.controller.openTake(saving).ok);
    app.access.current = 'free';
    assert.ok((await app.controller.create(draft(58_000), saving)).ok);
    media.stage('saving');
    assert.equal(outcome(await app.controller.create(draft(20_000), saving)), 'limitReached/resubscribe', 'no second recording');
    await app.controller.releaseTake(saving);

    app.access.current = 'pro';
    const cancelled = media.stage('cancelled');
    assert.ok(app.controller.openTake(cancelled).ok);
    await app.controller.releaseTake(cancelled);
    app.access.current = 'free';
    assert.equal(outcome(app.controller.openTake(cancelled)), 'limitReached/resubscribe', 'opening it again is a new attempt, with no allowance');
    assert.equal(outcome(await app.controller.create(draft(20_000), cancelled)), 'limitReached/resubscribe');
  });

  test('no take can be opened while access is checking, unknown, failed or unavailable, so no recording starts', async () => {
    const starts: [PepAccess, string][] = [
      ['checking', 'checking'],
      [pepFor('unknown'), 'checking'],
      [pepFor('error'), 'checking'],
      ['unavailable', 'unavailable'],
    ];
    for (const [start, error] of starts) {
      const { app, media } = await launched();
      app.access.current = start;
      assert.deepEqual(app.controller.openTake(media.stage('nopro')), { ok: false, error });
    }
  });

  test('a take opened on Free stays a 30-second take, even after upgrading during the attempt', async () => {
    const { app, media } = await launched();
    app.access.current = 'free';
    const take = media.stage('freetake');
    assert.deepEqual(app.controller.openTake(take), { ok: true, maxDurationMs: 30_000 });
    app.access.current = 'pro';
    assert.equal(outcome(await app.controller.create(draft(45_000), take)), 'tooLong', 'the upgrade does not lengthen this take');
    app.access.current = 'checking';
    assert.equal(outcome(await app.controller.create(draft(20_000), take)), 'checking');
    app.access.current = 'free';
    assert.equal(outcome(await app.controller.create(draft(45_000), take)), 'tooLong/upgrade');
    app.access.current = 'pro';
    assert.ok((await app.controller.create(draft(30_500), take)).ok, 'up to its limit plus the recorder tolerance');
  });

  test('lives in memory only: after a restart, current access applies to the same take', async () => {
    const { app, store, media } = await launched();
    app.access.current = 'pro';
    const take = media.stage('restart');
    assert.ok(app.controller.openTake(take).ok);
    await app.controller.flush();
    assert.ok(!(store.data.get(KEY) ?? '').includes('restart'), 'nothing about the take is stored');

    const next = pepApp(cloneStore(store), media.clone());
    await next.launch({ recover: false });
    next.access.current = 'free';
    assert.equal(outcome(await next.controller.create(draft(45_000), take)), 'tooLong/upgrade');
    assert.deepEqual(next.controller.openTake(take), { ok: true, maxDurationMs: 30_000 });
    assert.equal(outcome(await next.controller.create(draft(45_000), take)), 'tooLong/upgrade');
  });
});
