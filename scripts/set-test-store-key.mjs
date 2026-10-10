#!/usr/bin/env node
// Saves the RevenueCat Test Store PUBLIC SDK key (test_…) to .env.local without echoing it.
// Usage: npm run set-test-store-key   (or pipe the key in: pbpaste | npm run set-test-store-key)
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const NAME = 'EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, '.env.local');

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function isGitIgnored(path) {
  try {
    execFileSync('git', ['check-ignore', '-q', path], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function readPiped() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function readHidden(prompt) {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    let value = '';
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    const finish = (code) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      stdout.write('\n');
      if (code !== undefined) process.exit(code);
      resolve(value);
    };
    function onData(chunk) {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') return finish();
        if (char === '\u0003') return finish(130);
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else value += char;
      }
    }
    stdin.on('data', onData);
  });
}

if (!isGitIgnored(file)) fail('.env.local is not git-ignored here. Nothing was written.');

const raw = process.stdin.isTTY ? await readHidden('RevenueCat Test Store public SDK key (input hidden): ') : await readPiped();
// Bracketed-paste markers and surrounding whitespace are not part of the key.
const key = raw.replace(/\u001b\[20[01]~/g, '').trim();

if (!key) fail('No key entered. Nothing was written.');
if (key.startsWith('sk_')) fail('That is a RevenueCat SECRET key. Never put it in the app. Nothing was written.');
if (!key.startsWith('test_')) fail('That is not a Test Store key (it must start with test_). Nothing was written.');
if (!/^test_[A-Za-z0-9_]+$/.test(key)) fail('The key contains unexpected characters. Nothing was written.');

const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n') : [];
const assignment = new RegExp(`^\\s*(export\\s+)?${NAME}\\s*=`);
const index = lines.findIndex((line) => assignment.test(line));
const entry = `${NAME}=${key}`;
const replaced = index !== -1;
if (replaced) lines[index] = entry;
else {
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  lines.push(entry, '');
}
writeFileSync(file, lines.join('\n'), { mode: 0o600 });
chmodSync(file, 0o600);

console.log(`✓ ${replaced ? 'Updated' : 'Added'} ${NAME} in .env.local (test_…${key.slice(-4)}, ${key.length} characters).`);
console.log('  Restart Metro with: npx expo start --dev-client --clear');
