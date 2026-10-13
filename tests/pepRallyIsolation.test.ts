import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { STORAGE_KEYS, USER_DATA_KEYS } from '../src/data/storageKeys';
import { RESET_KEYS } from '../src/data/reset';

const root = join(__dirname, '..', '..');
const read = (...parts: string[]) => readFileSync(join(root, ...parts), 'utf8');
const pepSources = () => [
  ...readdirSync(join(root, 'src', 'pepRally')).map((name) => ({ name, text: read('src', 'pepRally', name) })),
  { name: 'pepRallyController.ts', text: read('src', 'data', 'pepRallyController.ts') },
];
const importsOf = (text: string) => [...text.matchAll(/^import\s+(type\s+)?[^;]*?from\s+'([^']+)'/gms)].map((match) => ({ typeOnly: !!match[1], from: match[2] }));

describe('Pep Rally isolation', () => {
  test('has its own storage key, separate from every other record, and is part of Reset everything', () => {
    assert.equal(STORAGE_KEYS.pepRallies, '@puphii/pep-rallies-v1');
    const others = Object.entries(STORAGE_KEYS).filter(([name]) => name !== 'pepRallies').map(([, key]) => key);
    assert.ok(!others.includes(STORAGE_KEYS.pepRallies));
    assert.ok(USER_DATA_KEYS.includes(STORAGE_KEYS.pepRallies));
    assert.ok(RESET_KEYS.includes(STORAGE_KEYS.pepRallies));
  });

  test('Pep Rally code never reaches into logs, plans, the game, savings, native modules or the network', () => {
    for (const { name, text } of pepSources()) {
      for (const { typeOnly, from } of importsOf(text)) {
        assert.ok(!/plan|puffLogic|savings|game|insights|screens|components/.test(from.replace('pepRally', '')), `${name} imports ${from}`);
        assert.ok(!/^(react|react-native|expo|@react-native|@revenuecat)/.test(from), `${name} imports ${from}`);
        if (from.includes('subscription')) {
          assert.ok(typeOnly && from.endsWith('/subscription/entitlement'), `${name} may only read the ProAccess type`);
        }
      }
      assert.ok(!/\bfetch\(|XMLHttpRequest|WebSocket|https?:\/\//.test(text), `${name} has no network access`);
    }
  });

  test('plans, tracking and subscriptions know nothing about Pep Rallies', () => {
    const dirs = ['plan', 'subscription', 'game'];
    for (const dir of dirs) {
      for (const name of readdirSync(join(root, 'src', dir))) {
        if (!/\.tsx?$/.test(name)) continue;
        assert.ok(!/pepRally|PepRally|pep-rallies/.test(read('src', dir, name)), `src/${dir}/${name}`);
      }
    }
    for (const file of ['puffLogic.ts', 'planController.ts', 'savings.ts', 'insights.ts']) {
      assert.ok(!/pepRally|PepRally/.test(read('src', 'data', file)), file);
    }
  });

  test('the store loads Pep Rallies with everything else and resets them, but Clear puff history leaves them alone', () => {
    const store = read('src', 'data', 'PuphiiStore.tsx');
    const body = (name: string) => {
      const start = store.indexOf(`const ${name} = useCallback(`);
      assert.ok(start >= 0, name);
      const end = store.indexOf('useCallback(', start + 30);
      return store.slice(start, end < 0 ? undefined : end);
    };
    assert.match(store, /writeJson<PepLibrary>\(STORAGE_KEYS\.pepRallies\)/);
    const load = store.indexOf('pepRallyController.load(result.pepRallies, { canSave: result.canSave })');
    assert.ok(load > 0 && load < store.indexOf('readyRef.current = true'));
    assert.match(body('resetAll'), /pepRallyController\.reset\(\)/);
    assert.ok(!/pepRally/i.test(body('clearLogs')));
    assert.ok(!/pepRally/i.test(body('commitLogs')));
  });

  test('no screen, media API or permission is part of this phase', () => {
    const store = read('src', 'data', 'PuphiiStore.tsx');
    const contextType = store.slice(store.indexOf('type PuphiiStore = {'), store.indexOf('const StoreContext'));
    assert.ok(!/pepRall|PepLibrary|PepRally/.test(contextType), 'nothing is exposed to screens yet');
    for (const { name, text } of pepSources()) {
      assert.ok(!/expo-audio|expo-file-system|expo-image-picker|AudioPlayer|AudioRecorder|setAudioModeAsync/.test(text), name);
    }
    const appJson = read('app.json');
    assert.match(appJson, /"microphonePermission": false/);
    assert.match(appJson, /"android\.permission\.RECORD_AUDIO"/);
  });
});
