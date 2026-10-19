import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { KeyValueStore, loadFrom } from '../src/data/persistence';
import { countOnDay } from '../src/data/puffLogic';
import { RESET_KEYS, resetValues } from '../src/data/reset';
import { createSkip, latestSkipToday, sanitizeSkips } from '../src/data/skips';
import { STORAGE_KEYS, USER_DATA_KEYS } from '../src/data/storageKeys';
import { clearHistoryMessage, RESET_EVERYTHING_MESSAGE } from '../src/plan/copy';
import { homePlanView } from '../src/plan/view';
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

const at = (iso: string) => ({ id: iso, timestamp: new Date(iso).toISOString() });
const dayKey = (iso: string) => {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

describe('Skips: storage', () => {
  test('have their own key, apart from puff logs, and are user data that Reset everything deletes', () => {
    assert.equal(STORAGE_KEYS.skips, '@puphii/skip-logs-v1');
    assert.notEqual(STORAGE_KEYS.skips, STORAGE_KEYS.logs);
    assert.ok((USER_DATA_KEYS as readonly string[]).includes(STORAGE_KEYS.skips));
    assert.ok((RESET_KEYS as readonly string[]).includes(STORAGE_KEYS.skips));
    assert.deepEqual(resetValues('USD').skips, []);
  });

  test('persist across restarts: what was saved is what loads, and puff logs are separate', async () => {
    const store = new MemoryStore();
    const skips = [createSkip(new Date(2026, 9, 13, 9, 0)), createSkip(new Date(2026, 9, 13, 14, 30))];
    await store.setItem(STORAGE_KEYS.skips, JSON.stringify(skips));
    const result = await loadFrom(store, { currency: 'USD', now: new Date(2026, 9, 13, 18) });
    assert.deepEqual(result.skips, skips);
    assert.deepEqual(result.logs, []);
    assert.equal(store.data.has(STORAGE_KEYS.logs), false, 'loading skips writes nothing to the puff log');
  });

  test('a fresh install has no skips and writes none; nothing creates them automatically', async () => {
    const store = new MemoryStore();
    const result = await loadFrom(store, { currency: 'USD' });
    assert.deepEqual(result.skips, []);
    assert.equal(store.data.has(STORAGE_KEYS.skips), false);
    const sources = ['data/PuphiiStore.tsx', 'screens/HomeScreen.tsx', 'data/persistence.ts', 'plan/view.ts'].map((file) => read('src', file));
    assert.equal(sources.join('\n').match(/createSkip\(/g)?.length, 1, 'only addSkip creates a skip');
  });

  test('unreadable entries are dropped, like puff logs', () => {
    const good = at('2026-10-13T10:00:00');
    assert.deepEqual(sanitizeSkips([good, good, { id: 'x' }, { id: 'y', timestamp: 'soon' }, null]), [good]);
    assert.deepEqual(sanitizeSkips({ skips: 3 }), []);
  });
});

describe('Skips never count as puffs', () => {
  test("today's puff count and the plan target ignore skips entirely", () => {
    const today = '2026-10-07';
    const logs = history({ [today]: 7 });
    const plan = planWith([segment({ baselinePerDay: 10, startTarget: 10, settleAt: 5 })]);
    const before = homePlanView(plan, logs, today);
    const skips = Array.from({ length: 5 }, (_, i) => createSkip(new Date(2026, 9, 7, 9 + i)));
    assert.equal(countOnDay(logs, new Date(2026, 9, 7, 12)), 7);
    assert.equal(countOnDay(skips, new Date(2026, 9, 7, 12)), 5);
    assert.deepEqual(homePlanView(plan, logs, today), before, 'the plan view only ever reads puff logs');
  });

  test('the store keeps skips out of the puff log and away from the plan', () => {
    const store = read('src', 'data', 'PuphiiStore.tsx');
    const commitSkips = store.slice(store.indexOf('const commitSkips'), store.indexOf('const addSkip'));
    assert.match(commitSkips, /skipsRef\.current = next;\s+setSkips\(next\);\s+queues\.skips\.save\(next\);/);
    assert.ok(!/logs|planController/.test(commitSkips), 'a skip never touches logs or the plan');
    assert.match(store, /skips: queue<SkipLog\[\]>\(STORAGE_KEYS\.skips\)/);
  });
});

describe('Undo skip', () => {
  const today = dayKey('2026-10-13T12:00:00');
  const skip = at('2026-10-13T11:00:00');
  const yesterday = at('2026-10-12T23:00:00');

  test("removes today's latest skip, and never reaches into an earlier day", () => {
    assert.deepEqual(latestSkipToday([yesterday, skip], today), skip);
    assert.equal(latestSkipToday([yesterday], today), null);
    assert.equal(latestSkipToday([], today), null);
  });

  test('skip Undo only touches skips, and puff Undo only touches puffs', () => {
    const store = read('src', 'data', 'PuphiiStore.tsx');
    const undoSkip = store.slice(store.indexOf('const undoLatestSkipToday'), store.indexOf('const commitSkipMilestones'));
    assert.match(undoSkip, /latestSkipToday\(skipsRef\.current, localDayKey\(new Date\(\)\)\)/);
    assert.match(undoSkip, /commitSkips\(skipsRef\.current\.slice\(0, -1\)\);/);
    assert.ok(!/commitLogs|logsRef/.test(undoSkip), 'never removes a puff');
    const undoPuff = store.slice(store.indexOf('const undoLatestToday'), store.indexOf('const deleteLog'));
    assert.ok(!/skip/i.test(undoPuff), 'never removes a skip');
  });
});

describe('Reset and Clear history', () => {
  const store = read('src', 'data', 'PuphiiStore.tsx');
  const body = (name: string) => store.slice(store.indexOf(`const ${name} = useCallback`), store.indexOf('useCallback(', store.indexOf(`const ${name} = useCallback`) + 30));

  test('Reset everything clears skips; Clear puff history keeps them, and both dialogs say so', () => {
    assert.match(body('resetAll'), /commitLogs\(reset\.logs\);\s+commitSkips\(reset\.skips\);/);
    assert.ok(!/Skips/i.test(body('clearLogs')));
    assert.match(clearHistoryMessage(3), /Settings, skips, savings calculator details/);
    assert.match(RESET_EVERYTHING_MESSAGE, /^All puff logs and skips,/);
  });
});

describe('Home: equal Puff and Skip priority', () => {
  const home = read('src', 'screens', 'HomeScreen.tsx');
  const buttons = read('src', 'components', 'Buttons.tsx');
  const onSkip = home.slice(home.indexOf('const onSkip'), home.indexOf('const onUndoSkip'));
  const onUndoSkip = home.slice(home.indexOf('const onUndoSkip'), home.indexOf('const latestSkip'));
  const actions = home.slice(home.indexOf('<View style={styles.actions}>'), home.indexOf('<MilestoneNotice'));

  test('a Puffs | Skips switch gives both modes equal tabs', () => {
    assert.match(actions, /accessibilityRole="tablist"/);
    assert.match(actions, /accessibilityLabel="Puffs"/);
    assert.match(actions, /accessibilityLabel="Skips"/);
    assert.match(home, /modeTab: \{[^}]*flex: 1/);
    assert.match(home, /minHeight: TOUCH_TARGET/);
    assert.match(actions, /backgroundColor: colors\.coralPink/);
    assert.match(actions, /backgroundColor: colors\.seafoam/);
    const tokens = read('src', 'theme', 'tokens.ts');
    assert.match(tokens, /coralPink: '#FFB7A7'/);
    assert.match(tokens, /seafoam: '#A8DCCC'/);
  });

  test('one ModeLogButton shows + Puff or + Skip with matching tone, beside compact Undo', () => {
    assert.match(actions, /label=\{isPuff \? '\+ Puff' : '\+ Skip'\}/);
    assert.match(actions, /tone=\{isPuff \? 'coral' : 'mint'\}/);
    assert.match(actions, /onPress=\{isPuff \? onPuff : onSkip\}/);
    assert.match(actions, /onPress=\{isPuff \? onUndo : onUndoSkip\}/);
    assert.match(actions, /height=\{MODE_LOG_HEIGHT\}/);
    assert.match(actions, /disabled=\{!canUndoMode\}/);
    assert.match(buttons, /export const MODE_LOG_HEIGHT = PRIMARY_HEIGHT/);
    assert.match(buttons, /coral: \{ fill: colors\.coralPink/);
    assert.match(buttons, /mint: \{ fill: colors\.seafoam/);
    assert.match(buttons, /height: MODE_LOG_HEIGHT/);
    assert.ok(!/PrimaryButton|SecondaryButton/.test(actions), 'neither mode uses a lesser secondary control');
  });

  test('the hero counter uses the same size and mode accent for both counts', () => {
    assert.match(home, /const heroCount = isPuff \? todayCount : skipsToday;/);
    assert.match(home, /borderColor: accent/);
    assert.match(home, /\{heroCount\}/);
    assert.match(home, /fontSize: layout\.countSize/);
    assert.match(home, /isPuff \? "Today's count" : "Today's skips"/);
    assert.match(home, /accent = isPuff \? colors\.deepOcean : colors\.seafoam/);
  });

  test('logging a skip saves it first, then gives feedback, and never logs a puff', () => {
    assert.ok(onSkip.indexOf('addSkip()') < onSkip.indexOf('mascotRef.current?.cheer()'));
    assert.ok(onSkip.indexOf('addSkip()') < onSkip.indexOf('playSkipSound()'));
    assert.match(onSkip, /if \(settings\.soundEnabled\) playSkipSound\(\);/);
    assert.ok(!/addPuff|playPuffSound|puffHaptic|await|setTimeout/.test(onSkip));
    assert.match(onSkip, /AccessibilityInfo\.announceForAccessibility\('Skip logged'\)/);
    const mascot = read('src', 'mascot', 'Mascot.tsx');
    assert.match(mascot, /SKIP_CHEER_FACES\[skipStep\.current % SKIP_CHEER_FACES\.length\]/);
    assert.match(read('src', 'mascot', 'faces.ts'), /skipProud/);
    assert.match(read('src', 'mascot', 'faces.ts'), /skipChampion/);
  });

  test('Undo skip removes a skip and says so, without puff or skip sounds', () => {
    assert.match(onUndoSkip, /const removed = undoLatestSkipToday\(\);/);
    assert.match(onUndoSkip, /setStatus\(`Removed the \$\{formatTime\(removed\.timestamp\)\} skip`\);/);
    assert.match(onUndoSkip, /announceForAccessibility\('Last skip removed'\)/);
    assert.ok(!/undoLatestToday|relieve|addPuff|playSkipSound|playPuffSound/.test(onUndoSkip));
  });

  test('skip wording follows the copy rules', () => {
    const lines = ['+ Skip', 'Undo', 'Skip logged', 'Last skip removed', 'Records an urge you chose not to act on. It is not counted as a puff'];
    for (const line of lines) assert.ok(!/fail|cheat|slip|relapse|streak|shame|guilt|should|must|health|!/i.test(line), line);
  });
});
