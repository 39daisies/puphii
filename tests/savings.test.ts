import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  assumptionText,
  clampReduction,
  currencyForLocale,
  defaultSavings,
  estimateSpending,
  fieldError,
  formatDuration,
  formatMoney,
  parseNumberInput,
  ProductInputs,
  projectGoal,
  REDUCTION_SCENARIOS,
  sanitizeSavings,
  SavingsSettings,
  savingsScenario,
} from '../src/data/savings';
import { corruptBackupKey, corruptBackupKeysFor, STORAGE_KEYS } from '../src/data/storageKeys';
import { createWriteQueue } from '../src/data/writeQueue';

const inputs = (patch: Partial<ProductInputs>): ProductInputs => ({
  price: null,
  unitsPerPurchase: null,
  basis: 'rate',
  rate: null,
  lastsDays: null,
  ...patch,
});

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`);

function ok(estimate: ReturnType<typeof estimateSpending>) {
  assert.equal(estimate.status, 'ok');
  if (estimate.status !== 'ok') throw new Error('unreachable');
  return estimate;
}

describe('spending estimates', () => {
  test('daily, weekly, monthly and annual cost from a pack price and daily use', () => {
    const estimate = ok(estimateSpending('cigarettes', inputs({ price: 600, unitsPerPurchase: 20, rate: 10 })));
    close(estimate.daily, 300);
    close(estimate.weekly, 2100);
    close(estimate.monthly, 300 * 30.4375);
    close(estimate.annual, 300 * 365.25);
  });

  test('"how long it lasts" uses price ÷ days', () => {
    const estimate = ok(estimateSpending('cigarettes', inputs({ basis: 'lasts', price: 600, lastsDays: 2 })));
    close(estimate.daily, 300);
  });

  test('only the chosen basis is used, so consumption is never counted twice', () => {
    const both = { price: 600, unitsPerPurchase: 20, rate: 20, lastsDays: 4 };
    close(ok(estimateSpending('cigarettes', inputs({ ...both, basis: 'lasts' }))).daily, 150);
    close(ok(estimateSpending('cigarettes', inputs({ ...both, basis: 'rate' }))).daily, 600);
  });

  test('vape pods are priced per pod and used per week', () => {
    close(ok(estimateSpending('vapePods', inputs({ price: 20, unitsPerPurchase: 4, rate: 2 }))).daily, 10 / 7);
    close(ok(estimateSpending('vapePods', inputs({ basis: 'lasts', price: 20, lastsDays: 10 }))).daily, 2);
  });

  test('disposables are priced per device, so pack size is ignored', () => {
    close(ok(estimateSpending('disposables', inputs({ price: 10, unitsPerPurchase: 50, rate: 3 }))).daily, 30 / 7);
    close(ok(estimateSpending('disposables', inputs({ basis: 'lasts', price: 10, lastsDays: 5 }))).daily, 2);
  });

  test('"other" always uses how long a purchase lasts', () => {
    close(ok(estimateSpending('other', inputs({ basis: 'rate', price: 50, rate: 99, lastsDays: 10 }))).daily, 5);
  });

  test('missing, negative and invalid inputs give an incomplete estimate, never NaN', () => {
    assert.deepEqual(estimateSpending('cigarettes', inputs({})), {
      status: 'incomplete',
      missing: ['price', 'unitsPerPurchase', 'rate'],
    });
    const bad: Partial<ProductInputs>[] = [
      { price: -5, unitsPerPurchase: 20, rate: 10 },
      { price: NaN, unitsPerPurchase: 20, rate: 10 },
      { price: Infinity, unitsPerPurchase: 20, rate: 10 },
      { price: 600, unitsPerPurchase: 0, rate: 10 },
      { price: 600, unitsPerPurchase: 2.5, rate: 10 },
      { price: 600, unitsPerPurchase: 20, rate: -1 },
    ];
    for (const patch of bad) assert.equal(estimateSpending('cigarettes', inputs(patch)).status, 'incomplete', JSON.stringify(patch));
    assert.deepEqual(estimateSpending('other', inputs({ price: 50, lastsDays: 0 })), { status: 'incomplete', missing: ['lastsDays'] });
  });

  test('a zero price or zero use is a zero estimate, not a result', () => {
    assert.deepEqual(estimateSpending('cigarettes', inputs({ price: 0, unitsPerPurchase: 20, rate: 10 })), { status: 'zero' });
    assert.deepEqual(estimateSpending('vapePods', inputs({ price: 20, unitsPerPurchase: 4, rate: 0 })), { status: 'zero' });
  });

  test('assumptions are described for each product and basis', () => {
    assert.match(assumptionText('cigarettes', 'rate'), /price of one pack ÷ cigarettes in it\) × cigarettes per day/);
    assert.match(assumptionText('vapePods', 'rate'), /pods per week ÷ 7/);
    assert.match(assumptionText('disposables', 'lasts'), /price of one disposable vape ÷ days it lasts/);
    assert.match(assumptionText('other', 'rate'), /÷ days it lasts/);
    assert.match(assumptionText('cigarettes', 'rate'), /30\.4375.*365\.25/);
  });
});

describe('reduction scenarios', () => {
  const estimate = estimateSpending('cigarettes', inputs({ price: 600, unitsPerPurchase: 20, rate: 10 }));

  test('savings are estimated spending × the reduction', () => {
    for (const percent of REDUCTION_SCENARIOS) {
      const scenario = savingsScenario(estimate, percent)!;
      close(scenario.daily, 300 * (percent / 100));
      close(scenario.monthly, 300 * 30.4375 * (percent / 100));
      close(scenario.annual, 300 * 365.25 * (percent / 100));
    }
  });

  test('the editable percentage stays between 5 and 100', () => {
    assert.equal(clampReduction(0), 5);
    assert.equal(clampReduction(-20), 5);
    assert.equal(clampReduction(150), 100);
    assert.equal(clampReduction(NaN), 50);
    assert.equal(clampReduction('40'), 50);
    assert.equal(clampReduction(42.4), 42);
  });

  test('no scenario without a complete estimate', () => {
    assert.equal(savingsScenario({ status: 'zero' }, 50), null);
    assert.equal(savingsScenario({ status: 'incomplete', missing: ['price'] }, 50), null);
  });
});

describe('savings goal', () => {
  const estimate = estimateSpending('cigarettes', inputs({ price: 600, unitsPerPurchase: 20, rate: 10 }));

  test('days to reach a goal under the chosen scenario', () => {
    // 50% of 300 a day is 150 a day: 10,000 takes 66.7 days, rounded up.
    assert.deepEqual(projectGoal(estimate, 50, 10_000), { status: 'ok', days: 67 });
    assert.deepEqual(projectGoal(estimate, 25, 75), { status: 'ok', days: 1 });
    assert.equal(formatDuration(67), 'about 3 months');
  });

  test('incomplete inputs and empty goals give a clear state instead of a number', () => {
    assert.deepEqual(projectGoal({ status: 'zero' }, 50, 10_000), { status: 'needsEstimate' });
    assert.deepEqual(projectGoal({ status: 'incomplete', missing: ['price'] }, 50, 10_000), { status: 'needsEstimate' });
    for (const amount of [null, 0, -100, NaN, Infinity]) assert.deepEqual(projectGoal(estimate, 50, amount), { status: 'needsAmount' });
  });

  test('goals more than 50 years away are not given a date', () => {
    assert.deepEqual(projectGoal(estimate, 5, 1e11), { status: 'beyondRange' });
  });

  test('durations read naturally', () => {
    assert.equal(formatDuration(1), 'about 1 day');
    assert.equal(formatDuration(13), 'about 13 days');
    assert.equal(formatDuration(14), 'about 2 weeks');
    assert.equal(formatDuration(56), 'about 8 weeks');
    assert.equal(formatDuration(57), 'about 2 months');
    assert.equal(formatDuration(700), 'about 23 months');
    assert.equal(formatDuration(731), 'about 2 years');
    assert.equal(formatDuration(913), 'about 2.5 years');
    assert.equal(formatDuration(NaN), '');
  });
});

describe('number input', () => {
  test('parses common ways of typing amounts', () => {
    const cases: [string, number][] = [
      ['12', 12],
      ['12.50', 12.5],
      ['12,50', 12.5],
      ['1,234', 1234],
      ['1,234.56', 1234.56],
      ['1.234,56', 1234.56],
      ['1 234', 1234],
      ['0,5', 0.5],
      ['.5', 0.5],
      ['1.234.567', 1234567],
      ['-3', -3],
    ];
    for (const [text, value] of cases) assert.deepEqual(parseNumberInput(text), { kind: 'number', value }, text);
  });

  test('rejects text that is not a number, and treats blank as empty', () => {
    assert.deepEqual(parseNumberInput(''), { kind: 'empty' });
    assert.deepEqual(parseNumberInput('   '), { kind: 'empty' });
    for (const text of ['abc', '12abc', '1.2.3', '1,2,3', '.', '--5', '5-', 'NaN', 'Infinity', '1e5']) {
      assert.deepEqual(parseNumberInput(text), { kind: 'invalid' }, text);
    }
  });

  test('explains out-of-range values', () => {
    assert.equal(fieldError('price', -1), 'Enter a number that isn’t negative.');
    assert.equal(fieldError('unitsPerPurchase', 2.5), 'Enter a whole number.');
    assert.equal(fieldError('unitsPerPurchase', 0), 'Enter 1 or more.');
    assert.equal(fieldError('lastsDays', 0), 'Enter a number above 0.');
    assert.match(fieldError('lastsDays', 5000)!, /or less/);
    assert.equal(fieldError('price', 0), null);
  });
});

describe('currency', () => {
  test('formats amounts for the chosen currency and locale', () => {
    assert.equal(formatMoney(1234.5, 'USD', 'en-US'), '$1,234.50');
    assert.equal(formatMoney(1234.5, 'JPY', 'en-US'), '¥1,235');
    assert.equal(formatMoney(1234.5, 'GBP', 'en-GB'), '£1,234.50');
    assert.equal(formatMoney(1234.5, 'EUR', 'de-DE').replace(/\s/g, ' '), '1.234,50 €');
    assert.equal(formatMoney(0, 'USD', 'en-US'), '$0.00');
  });

  test('never shows NaN and survives an unusable currency code', () => {
    assert.equal(formatMoney(NaN, 'USD', 'en-US'), '—');
    assert.equal(formatMoney(Infinity, 'USD', 'en-US'), '—');
    assert.equal(formatMoney(5, 'not-a-code', 'en-US'), 'not-a-code 5.00');
  });

  test('suggests a currency from the device region, without assuming any one country', () => {
    assert.equal(currencyForLocale('ja-JP'), 'JPY');
    assert.equal(currencyForLocale('en-US'), 'USD');
    assert.equal(currencyForLocale('de-DE'), 'EUR');
    assert.equal(currencyForLocale('en-GB'), 'GBP');
    assert.equal(currencyForLocale('zh-Hant-TW'), 'TWD');
    assert.equal(currencyForLocale('fr'), 'USD');
    assert.equal(currencyForLocale(undefined), 'USD');
  });
});

describe('calculator persistence', () => {
  const filled = (): SavingsSettings => {
    const settings = defaultSavings('JPY');
    settings.productType = 'vapePods';
    settings.products.vapePods = { price: 2400, unitsPerPurchase: 4, basis: 'lasts', rate: 3, lastsDays: 6 };
    settings.products.cigarettes = { price: 600, unitsPerPurchase: 20, basis: 'rate', rate: 10, lastsDays: null };
    settings.reductionPercent = 35;
    settings.goalName = 'Weekend trip';
    settings.goalAmount = 50_000;
    return settings;
  };

  test('settings survive a restart: saved through the write queue, then read back', async () => {
    const disk = new Map<string, string>();
    const queue = createWriteQueue<SavingsSettings>(
      async (value) => {
        disk.set(STORAGE_KEYS.savings, JSON.stringify(value));
      },
      () => assert.fail('write failed'),
    );
    let state = defaultSavings('JPY');
    for (let percent = 5; percent <= 35; percent += 5) {
      state = { ...state, reductionPercent: percent };
      queue.save(state);
    }
    const final = filled();
    queue.save(final);
    await queue.flush();

    // A fresh launch only has what is on disk.
    const restored = sanitizeSavings(JSON.parse(disk.get(STORAGE_KEYS.savings)!), 'USD');
    assert.deepEqual(restored, final);
  });

  test('missing or invalid saved values fall back safely', () => {
    assert.deepEqual(sanitizeSavings(null, 'EUR'), defaultSavings('EUR'));
    assert.deepEqual(sanitizeSavings('garbage', 'nope'), defaultSavings('USD'));
    const restored = sanitizeSavings(
      {
        productType: 'cigars',
        currency: 'ZZZ',
        products: { cigarettes: { price: -3, unitsPerPurchase: 2.5, basis: 'sometimes', rate: 'ten', lastsDays: 0 }, other: { basis: 'rate' } },
        reductionPercent: 400,
        goalName: 'x'.repeat(100),
        goalAmount: -1,
      },
      'GBP',
    );
    assert.equal(restored.productType, 'cigarettes');
    assert.equal(restored.currency, 'GBP');
    assert.deepEqual(restored.products.cigarettes, { price: null, unitsPerPurchase: null, basis: 'rate', rate: null, lastsDays: null });
    assert.equal(restored.products.other.basis, 'lasts');
    assert.equal(restored.reductionPercent, 100);
    assert.equal(restored.goalName.length, 40);
    assert.equal(restored.goalAmount, null);
  });

  test('a full reset also finds set-aside copies of calculator data', () => {
    const keys = [STORAGE_KEYS.savings, corruptBackupKey(STORAGE_KEYS.savings, 7), corruptBackupKey(STORAGE_KEYS.logs, 8)];
    assert.deepEqual(corruptBackupKeysFor(keys, [STORAGE_KEYS.savings]), ['@puphii/savings-v1-corrupt-7']);
  });
});
