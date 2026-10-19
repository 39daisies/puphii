import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import type { CustomerInfo, PurchasesEntitlementInfo } from 'react-native-purchases';
import { PepActionResult, PepTakeResult } from '../src/data/pepRallyController';
import { connectPepAccess, PepAccessOptions, pepAccessSource } from '../src/data/pepRallyAccessBridge';
import { PepResult } from '../src/pepRally/lifecycle';
import { visibleRallies } from '../src/pepRally/model';
import { Access, accessFor } from '../src/subscription/entitlement';
import { Clock, createRevenueCatService, PurchasesSdk } from '../src/subscription/revenueCat';
import { MemoryStore } from './plan/storeHarness';
import { DRAFT, KEY, libraryOf, MemoryMedia, pepApp, storedRally } from './pepRally/fakes';

const ROOT = join(__dirname, '..', '..');
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');

const ENTITLEMENT = 'test-entitlement';
const PRODUCTS = { annual: 'test.annual', monthly: 'test.monthly', weekly: 'test.weekly' };
const REQUEST_DATE = '2026-10-10T12:00:00.000Z';
const DAY = 24 * 60 * 60 * 1000;
const daysFromRequest = (days: number) => new Date(Date.parse(REQUEST_DATE) + days * DAY).toISOString();

/** A release build with the paywall shown, on an iPhone. */
const GATED = { gatingEnabled: true, allowMock: false };
const IOS: PepAccessOptions = { platform: 'ios', gatingActive: true };

function entry(overrides: Partial<PurchasesEntitlementInfo> = {}): PurchasesEntitlementInfo {
  return {
    identifier: ENTITLEMENT,
    isActive: true,
    willRenew: true,
    periodType: 'NORMAL',
    productIdentifier: PRODUCTS.annual,
    productPlanIdentifier: null,
    isSandbox: true,
    expirationDate: daysFromRequest(30),
    unsubscribeDetectedAt: null,
    billingIssueDetectedAt: null,
    verification: 'NOT_REQUESTED',
    ...overrides,
  } as PurchasesEntitlementInfo;
}

function customer(entries: PurchasesEntitlementInfo[] = []): CustomerInfo {
  const all = Object.fromEntries(entries.map((e) => [e.identifier, e]));
  const active = Object.fromEntries(entries.filter((e) => e.isActive).map((e) => [e.identifier, e]));
  return { entitlements: { all, active, verification: 'NOT_REQUESTED' }, requestDate: REQUEST_DATE } as unknown as CustomerInfo;
}

const NEVER_SUBSCRIBED = () => customer();
const ACTIVE = () => customer([entry()]);
const EXPIRED = () => customer([entry({ isActive: false, willRenew: false, expirationDate: daysFromRequest(-1) })]);
const settle = async () => {
  for (let n = 0; n < 3; n += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

/** The subscription service as the app runs it, with timers that only fire when a test says so. */
async function subscription(first: () => CustomerInfo) {
  const listeners = new Set<(info: CustomerInfo) => void>();
  const timers: (() => void)[] = [];
  const fake = {
    nextCustomerInfo: (): Promise<CustomerInfo> => Promise.resolve(first()),
    nextRestore: (): Promise<CustomerInfo> => Promise.resolve(customer()),
    /** RevenueCat's listener reads customer info asynchronously, as on a device. */
    async emit(info: CustomerInfo) {
      listeners.forEach((listener) => listener(info));
      await settle();
    },
    /** Runs every pending timer, as when the app has stayed open past the expiry. */
    async fireTimers() {
      for (const timer of timers.splice(0)) timer();
      await settle();
    },
  };
  const sdk: PurchasesSdk = {
    configure: () => undefined,
    getCustomerInfo: () => fake.nextCustomerInfo(),
    invalidateCustomerInfoCache: () => Promise.resolve(),
    restorePurchases: () => fake.nextRestore(),
    addCustomerInfoUpdateListener: (listener) => listeners.add(listener),
    removeCustomerInfoUpdateListener: (listener) => listeners.delete(listener),
    checkTrialEligibility: (ids) => Promise.resolve(Object.fromEntries(ids.map((id) => [id, { status: 2 }]))),
  };
  const clock: Clock = {
    now: () => Date.parse(REQUEST_DATE),
    setTimeout: (callback) => timers.push(callback),
    clearTimeout: () => undefined,
  };
  const service = createRevenueCatService({
    sdk,
    key: { ok: true, apiKey: 'appl_TestOnlyKey123', source: 'platform' },
    entitlementId: ENTITLEMENT,
    productIds: PRODUCTS,
    appState: { current: () => 'active', subscribe: () => () => undefined },
    clock,
  });
  service.start();
  await settle();
  /** What EntitlementProvider's `currentAccess` returns with the paywall shown. */
  const currentAccess = (): Access => accessFor(service.current(), GATED);
  return { fake, service, currentAccess };
}

/** The controller, launched on its own storage and connected to the subscription service through the bridge. */
async function connectedApp(first: () => CustomerInfo, initial: Record<string, unknown> = {}, options = IOS) {
  const sub = await subscription(first);
  const media = new MemoryMedia();
  const app = pepApp(new MemoryStore(initial), media);
  await app.launch();
  const disconnect = connectPepAccess(app.controller, sub.currentAccess, options);
  return { ...sub, app, media, disconnect };
}

const errorOf = (result: PepResult | PepActionResult | PepTakeResult): string => (result.ok ? 'ok' : result.error);
const draft = (durationMs: number) => ({ ...DRAFT, audio: { ...DRAFT.audio, durationMs } });
let takeNumber = 0;
const record = (app: ReturnType<typeof pepApp>, durationMs: number) => app.controller.create(draft(durationMs), app.media!.stage(`bridge${takeNumber++}`));
const ONE_SAVED = { [KEY]: libraryOf(storedRally('pr-a-bridged1')) };

describe('Pep Rally access follows the subscription service live (V-B S3)', () => {
  test('C1: a renewal reported by the customer-info listener lets the next save use Pro limits', async () => {
    const { app, fake } = await connectedApp(EXPIRED, ONE_SAVED);
    assert.equal(errorOf(await record(app, 20_000)), 'limitReached', 'expired: one recording only');
    assert.equal(errorOf(app.controller.setFavorite('pr-a-bridged1', true)), 'proRequired');

    await fake.emit(ACTIVE());
    assert.equal(errorOf(await record(app, 45_000)), 'ok', 'no reload, no new render');
    assert.equal(errorOf(app.controller.setFavorite('pr-a-bridged1', true)), 'ok');
  });

  test('C2: an expiry re-check that ends Pro mid-session applies Free to the next new action only', async () => {
    const { app, fake } = await connectedApp(ACTIVE, ONE_SAVED);
    assert.equal(errorOf(await record(app, 45_000)), 'ok');
    const before = structuredClone(app.controller.current());

    fake.nextCustomerInfo = () => Promise.resolve(EXPIRED());
    await fake.fireTimers();
    assert.deepEqual(app.controller.current(), before, 'expiry alone changes nothing that is saved');
    assert.equal(errorOf(await record(app, 20_000)), 'limitReached');
    assert.equal(errorOf(app.controller.setTags('pr-a-bridged1', ['work'])), 'proRequired');
    assert.ok(app.controller.rename('pr-a-bridged1', 'Still here').ok, 'what was saved stays usable');
    assert.equal(visibleRallies(app.controller.current()).length, 2);
  });

  test('C3: a take started under Pro may finish and save with Pro limits after access ends', async () => {
    const { app, media, fake } = await connectedApp(ACTIVE, ONE_SAVED);
    const take = media.stage('startedpro');
    assert.deepEqual(app.controller.openTake(take), { ok: true, maxDurationMs: 60_000 });

    fake.nextCustomerInfo = () => Promise.resolve(EXPIRED());
    await fake.fireTimers();
    assert.equal(errorOf(app.controller.openTake(media.stage('afterexpiry'))), 'limitReached', 'a new take gets Free');
    assert.equal(errorOf(await app.controller.create(draft(58_000), take)), 'ok', 'the take already started keeps its Pro limits');
    await app.controller.releaseTake(take);
    assert.equal(errorOf(await record(app, 20_000)), 'limitReached');
  });

  test('C4: restoring purchases that grant Pro enables Pro actions at once', async () => {
    const { app, fake, service } = await connectedApp(NEVER_SUBSCRIBED, ONE_SAVED);
    assert.equal(errorOf(await record(app, 20_000)), 'limitReached');

    fake.nextRestore = () => Promise.resolve(ACTIVE());
    await service.restorePurchases();
    assert.equal(errorOf(await record(app, 55_000)), 'ok');
    assert.equal(errorOf(app.controller.setFavorite('pr-a-bridged1', true)), 'ok');
    assert.deepEqual(app.controller.openTake(app.media!.stage('restored')), { ok: true, maxDurationMs: 60_000 });
  });

  test('C5: an access value a screen captured earlier cannot apply stale limits', async () => {
    const { app, fake, currentAccess } = await connectedApp(ACTIVE, ONE_SAVED);
    const shownAsPro = pepAccessSource(currentAccess, IOS)();
    assert.equal(shownAsPro, 'pro');

    await fake.emit(EXPIRED());
    assert.equal(shownAsPro, 'pro', 'the screen still shows what it rendered');
    assert.equal(errorOf(app.controller.setFavorite('pr-a-bridged1', true)), 'proRequired', 'the controller reads access itself');
    assert.equal(errorOf(await record(app, 20_000)), 'limitReached');

    const shownAsFree = pepAccessSource(currentAccess, IOS)();
    assert.equal(shownAsFree, 'free');
    await fake.emit(ACTIVE());
    assert.equal(errorOf(app.controller.setFavorite('pr-a-bridged1', true)), 'ok', 'nor can an older Free answer block Pro');
  });
});

describe('Pep Rally access bridge guards', () => {
  test('on Android, Pep Rallies are unavailable even with Pro', async () => {
    const { app, media } = await connectedApp(ACTIVE, ONE_SAVED, { platform: 'android', gatingActive: true });
    assert.deepEqual(app.controller.openTake(media.stage('android')), { ok: false, error: 'unavailable' });
    assert.equal(errorOf(await record(app, 20_000)), 'unavailable');
    assert.equal(errorOf(app.controller.setFavorite('pr-a-bridged1', true)), 'unavailable');
    assert.ok(app.controller.rename('pr-a-bridged1', 'Kept').ok, 'what was saved stays usable');
  });

  test('where the paywall is hidden, global Pro access is open but Pep Rallies are unavailable', async () => {
    const sub = await subscription(NEVER_SUBSCRIBED);
    const ungated = () => accessFor(sub.service.current(), { gatingEnabled: false, allowMock: false });
    assert.equal(ungated().pro, 'granted');
    assert.equal(pepAccessSource(ungated, { platform: 'ios', gatingActive: false })(), 'unavailable');
    for (const platform of ['ios', 'android', 'web']) {
      assert.equal(pepAccessSource(sub.currentAccess, { platform, gatingActive: false })(), 'unavailable', platform);
    }
  });

  test('access is read from the service on every call, never kept', async () => {
    const sub = await subscription(NEVER_SUBSCRIBED);
    let reads = 0;
    const source = pepAccessSource(() => {
      reads += 1;
      return sub.currentAccess();
    }, IOS);
    assert.equal(source(), 'free');
    await sub.fake.emit(ACTIVE());
    assert.equal(source(), 'pro');
    assert.equal(reads, 2);
    assert.equal(pepAccessSource(() => accessFor({ status: 'unknown' }, GATED), IOS)(), 'checking');
  });

  test('disconnecting turns every new action back to checking', async () => {
    const { app, disconnect } = await connectedApp(ACTIVE, ONE_SAVED);
    assert.equal(errorOf(app.controller.setFavorite('pr-a-bridged1', true)), 'ok');
    disconnect();
    assert.equal(errorOf(app.controller.setTags('pr-a-bridged1', ['work'])), 'checking');
    assert.equal(errorOf(await record(app, 20_000)), 'checking');
  });

  test('a subscription service that throws counts as checking', async () => {
    const media = new MemoryMedia();
    const app = pepApp(new MemoryStore(ONE_SAVED), media);
    await app.launch();
    connectPepAccess(
      app.controller,
      () => {
        throw new Error('provider gone');
      },
      IOS,
    );
    assert.deepEqual(app.controller.openTake(media.stage('throws')), { ok: false, error: 'checking' });
  });
});

describe('Pep Rally access wiring in the app', () => {
  const entitlementProvider = read('src', 'subscription', 'EntitlementProvider.tsx');
  const provider = read('src', 'data', 'PepRallyProvider.tsx');
  const app = read('App.tsx');

  test('EntitlementProvider adds currentAccess from the service, and global access is worked out as before', () => {
    assert.match(
      entitlementProvider,
      /const currentAccess = useCallback\(\(\) => accessFor\(service\.current\(\), \{ gatingEnabled: PRO_GATING_ACTIVE, allowMock: __DEV__ \}\), \[service\]\);/,
    );
    assert.match(entitlementProvider, /access: accessFor\(entitlement, \{ gatingEnabled: PRO_GATING_ACTIVE, allowMock: __DEV__ \}\),\s*currentAccess,/);
    assert.ok(!/pepRall|PepRall|\.\.\/data\//.test(entitlementProvider), 'the subscription code knows nothing about Pep Rallies');
  });

  test('PepRallyProvider connects live access on mount and disconnects on unmount', () => {
    assert.match(provider, /useEffect\(\(\) => connectPepAccess\(controller, currentAccess, ACCESS_OPTIONS\), \[controller, currentAccess\]\);/);
    assert.match(provider, /const ACCESS_OPTIONS: PepAccessOptions = \{ platform: Platform\.OS, gatingActive: PRO_GATING_ACTIVE \};/);
    assert.match(provider, /const controller = useStorePepRallyController\(\);/);
  });

  test('PepRallyProvider shows no UI and touches no media, microphone or file yet', () => {
    assert.ok(!/attachMedia|recover\(|openTake|expo-audio|expo-file-system|expo-image-picker|\/screens\/|\/components\//.test(provider));
    assert.match(provider, /import \{ Platform \} from 'react-native';/, 'nothing else from React Native');
    assert.match(provider, /return <PepRallyContext\.Provider value=\{value\}>\{children\}<\/PepRallyContext\.Provider>;/);
  });

  test('App mounts PepRallyProvider inside both the store and the subscription provider', () => {
    assert.match(app, /AccessRoot/);
    assert.match(app, /<\/PepRallyProvider>\s*<\/EntitlementProvider>\s*<\/PuphiiProvider>/);
  });
});
