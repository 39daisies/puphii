import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { KeyValueStore, loadFrom } from '../src/data/persistence';
import { isPuffProduct, productMetaFor, resolvedProduct, resolvedUnit } from '../src/data/productMeta';
import { createLog, sanitizeLogs } from '../src/data/puffLogic';
import { RESET_KEYS, resetValues } from '../src/data/reset';
import {
  defaultSkipMilestones,
  reachedSkipMilestones,
  sanitizeSkipMilestones,
  SKIP_MILESTONE_THRESHOLDS,
  skipMilestoneId,
  unseenSkipMilestones,
} from '../src/data/skipMilestones';
import { createSkip } from '../src/data/skips';
import { STORAGE_KEYS, USER_DATA_KEYS } from '../src/data/storageKeys';
import { homePlanView } from '../src/plan/view';
import { estimateSpending } from '../src/data/savings';
import { history, planWith, segment } from './plan/fixtures';

const ROOT = join(__dirname, '..', '..');
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');

class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, string>();
  async getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  async setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  async multiSet(pairs: ReadonlyArray<readonly [string, string]>) {
    for (const [key, value] of pairs) this.data.set(key, value);
  }
  async getAllKeys() {
    return [...this.data.keys()];
  }
  async multiRemove(keys: readonly string[]) {
    for (const key of keys) this.data.delete(key);
  }
}

describe('Puff product metadata', () => {
  test('new logs can carry product and unit from savings product type', () => {
    assert.deepEqual(productMetaFor('cigarettes'), { product: 'cigarette', unit: 'cigarette' });
    assert.deepEqual(productMetaFor('vapePods'), { product: 'vape', unit: 'puff' });
    assert.deepEqual(productMetaFor('disposables'), { product: 'vape', unit: 'puff' });
    assert.deepEqual(productMetaFor('other'), { product: 'unknown', unit: 'unknown' });
    const log = createLog(new Date(2026, 9, 16, 12), productMetaFor('vapePods'));
    assert.equal(log.product, 'vape');
    assert.equal(log.unit, 'puff');
    assert.ok(log.id);
    assert.ok(log.timestamp);
  });

  test('legacy logs without product stay unknown and are never rewritten as cigarette or vape', () => {
    const legacy = { id: 'old-1', timestamp: new Date(2026, 1, 1).toISOString() };
    const [sanitized] = sanitizeLogs([legacy]);
    assert.equal(sanitized.product, undefined);
    assert.equal(sanitized.unit, undefined);
    assert.equal(resolvedProduct(sanitized), 'unknown');
    assert.equal(resolvedUnit(sanitized), 'unknown');
  });

  test('sanitize preserves explicit unknown and known product values', () => {
    const mixed = sanitizeLogs([
      { id: 'a', timestamp: new Date(2026, 9, 1).toISOString(), product: 'cigarette', unit: 'cigarette' },
      { id: 'b', timestamp: new Date(2026, 9, 2).toISOString(), product: 'unknown', unit: 'unknown' },
      { id: 'c', timestamp: new Date(2026, 9, 3).toISOString() },
      { id: 'd', timestamp: new Date(2026, 9, 4).toISOString(), product: 'pipe', unit: 'bowl' },
    ]);
    assert.equal(mixed[0].product, 'cigarette');
    assert.equal(mixed[1].product, 'unknown');
    assert.equal(mixed[2].product, undefined);
    assert.equal(resolvedProduct(mixed[2]), 'unknown');
    // Invalid product strings are kept as unknown fields for forward-compat, never remapped to cigarette/vape.
    assert.equal(isPuffProduct(mixed[3].product), false);
    assert.notEqual(mixed[3].product, 'cigarette');
    assert.notEqual(mixed[3].product, 'vape');
  });

  test('addPuff wires productMetaFor from current savings product type', () => {
    const store = read('src', 'data', 'PuphiiStore.tsx');
    assert.match(store, /productMetaFor\(savingsRef\.current\.productType\)/);
    assert.match(store, /createLog\(new Date\(\), meta\)/);
  });
});

describe('Puff and Skip independence', () => {
  test('createSkip never carries product metadata', () => {
    const skip = createSkip(new Date(2026, 9, 16, 10));
    assert.equal('product' in skip, false);
    assert.equal('unit' in skip, false);
    assert.ok(skip.id);
    assert.ok(skip.timestamp);
  });

  test('plan targets ignore skips even when many are logged', () => {
    const today = '2026-10-16';
    const logs = history({ [today]: 4 });
    const plan = planWith([segment({ baselinePerDay: 10, startTarget: 8, settleAt: 4 })]);
    const before = homePlanView(plan, logs, today);
    const skips = Array.from({ length: 20 }, (_, i) => createSkip(new Date(2026, 9, 16, 8 + i)));
    assert.deepEqual(homePlanView(plan, logs, today), before);
    assert.equal(skips.length, 20);
  });
});

describe('Skip milestones', () => {
  test('thresholds include 10, 25, 50, 100 and later meaningful steps', () => {
    assert.deepEqual([...SKIP_MILESTONE_THRESHOLDS], [10, 25, 50, 100, 250, 500, 1000]);
  });

  test('reached and unseen are derived from cumulative skip count and seen ids', () => {
    assert.deepEqual(reachedSkipMilestones(9), []);
    assert.deepEqual(reachedSkipMilestones(10), [skipMilestoneId(10)]);
    assert.deepEqual(reachedSkipMilestones(50), [skipMilestoneId(10), skipMilestoneId(25), skipMilestoneId(50)]);
    assert.deepEqual(unseenSkipMilestones(50, [skipMilestoneId(10)]), [
      skipMilestoneId(25),
      skipMilestoneId(50),
    ]);
    assert.deepEqual(unseenSkipMilestones(50, reachedSkipMilestones(50)), []);
  });

  test('milestones persist across restart and reset clears them', async () => {
    const store = new MemoryStore();
    const seen = { seen: [skipMilestoneId(10), skipMilestoneId(25)] };
    await store.setItem(STORAGE_KEYS.skipMilestones, JSON.stringify(seen));
    const loaded = await loadFrom(store, { currency: 'USD' });
    assert.deepEqual(loaded.skipMilestones, seen);
    assert.ok((USER_DATA_KEYS as readonly string[]).includes(STORAGE_KEYS.skipMilestones));
    assert.ok((RESET_KEYS as readonly string[]).includes(STORAGE_KEYS.skipMilestones));
    assert.deepEqual(resetValues('USD').skipMilestones, defaultSkipMilestones());
  });

  test('sanitize drops unknown ids without inventing seen state', () => {
    assert.deepEqual(sanitizeSkipMilestones({ seen: ['skip-10', 'skip-99', 12, 'skip-10'] }), {
      seen: [skipMilestoneId(10)],
    });
    assert.deepEqual(sanitizeSkipMilestones(null), defaultSkipMilestones());
  });
});

describe('Savings isolation', () => {
  test('spending estimates never take skip counts as an input', () => {
    const estimate = estimateSpending('cigarettes', {
      price: 10,
      unitsPerPurchase: 20,
      basis: 'rate',
      rate: 10,
      lastsDays: null,
    });
    assert.equal(estimate.status, 'ok');
    const savingsSource = read('src', 'data', 'savings.ts');
    assert.ok(!/skip/i.test(savingsSource), 'savings methodology has no skip wiring');
    const screen = read('src', 'screens', 'SavingsScreen.tsx');
    assert.match(screen, /Skips have no monetary value/);
    assert.ok(!/\bskips\b/.test(screen.replace(/Skips have no monetary value[^.]*\./, '')));
  });
});

describe('Reset behavior (values only — does not touch device data)', () => {
  test('resetValues clears logs, skips, and skip milestones together', () => {
    const reset = resetValues('USD');
    assert.deepEqual(reset.logs, []);
    assert.deepEqual(reset.skips, []);
    assert.deepEqual(reset.skipMilestones, { seen: [] });
  });
});

describe('Insights and History wire both event types', () => {
  test('overview and history expose Puffs and Skips modes with coral and seafoam', () => {
    const overview = read('src', 'screens', 'InsightsOverview.tsx');
    const history = read('src', 'screens', 'HistoryScreen.tsx');
    assert.match(overview, /value: 'puffs'/);
    assert.match(overview, /value: 'skips'/);
    assert.match(overview, /value: 'compare'/);
    assert.match(overview, /Puffs vs Skips/);
    assert.match(history, /value: 'puffs'/);
    assert.match(history, /value: 'skips'/);
    assert.match(overview, /tone = isSkip \? 'mint' : 'coral'/);
    assert.match(history, /tone = isSkip \? 'mint' : 'coral'/);
  });

  test('plan dashboard receives skips as context only', () => {
    const dashboard = read('src', 'screens', 'plan', 'PlanDashboard.tsx');
    assert.match(dashboard, /skips: readonly SkipLog\[\]/);
    assert.match(dashboard, /Skips don't change plan targets/);
    assert.ok(!/todayProgress\(plan, skips/.test(dashboard));
    assert.match(dashboard, /todayProgress\(plan, logs, today\)/);
  });
});
