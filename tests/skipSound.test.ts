import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const ROOT = join(__dirname, '..', '..');
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');

describe('Skip sound asset', () => {
  test('ships a short WAV beside the puff sound, same PCM format family', () => {
    const skipPath = join(ROOT, 'assets', 'sounds', 'skip-chime.wav');
    const puffPath = join(ROOT, 'assets', 'sounds', 'bubble-bloop.wav');
    assert.equal(existsSync(skipPath), true);
    assert.equal(existsSync(puffPath), true);
    const skip = readFileSync(skipPath);
    const puff = readFileSync(puffPath);
    assert.equal(skip.toString('ascii', 0, 4), 'RIFF');
    assert.equal(skip.toString('ascii', 8, 12), 'WAVE');
    assert.equal(puff.toString('ascii', 0, 4), 'RIFF');
    // Distinct files — Skip never reuses the puff bloop.
    assert.notEqual(skip.equals(puff), true);
    assert.ok(skip.length < 80_000, 'skip chime stays a small bundled asset');
  });
});

describe('Skip sound playback wiring', () => {
  const feedback = read('src', 'services', 'feedback.ts');
  const home = read('src', 'screens', 'HomeScreen.tsx');

  test('playSkipSound loads skip-chime through expo-audio, separate from the puff player', () => {
    assert.match(feedback, /export function playSkipSound/);
    assert.match(feedback, /skip-chime\.wav/);
    assert.match(feedback, /bubble-bloop\.wav/);
    assert.match(feedback, /playsInSilentMode: false/);
    assert.match(feedback, /interruptionMode: 'mixWithOthers'/);
    assert.match(feedback, /seekTo\(0\)\.then\(play, play\)/);
    assert.match(feedback, /skipPlayer|getSkipPlayer/);
    assert.ok(!/await play|await sound/.test(feedback), 'playback never blocks callers');
  });

  test('Home plays Skip sound only after a successful Skip, when sound is enabled', () => {
    const onSkip = home.slice(home.indexOf('const onSkip'), home.indexOf('const onUndoSkip'));
    assert.match(onSkip, /const skip = addSkip\(\);/);
    assert.match(onSkip, /if \(!skip\) return;/);
    assert.ok(onSkip.indexOf('if (!skip) return') < onSkip.indexOf('playSkipSound()'));
    assert.match(onSkip, /if \(settings\.soundEnabled\) playSkipSound\(\);/);
    assert.match(onSkip, /mascotRef\.current\?\.cheer\(\)/);
    assert.ok(!/playPuffSound/.test(onSkip));
  });

  test('Undo, mode switch, and puff logging do not call playSkipSound', () => {
    const onUndo = home.slice(home.indexOf('const onUndo ='), home.indexOf('const onSkip'));
    const onUndoSkip = home.slice(home.indexOf('const onUndoSkip'), home.indexOf('const latestSkip'));
    const onPuff = home.slice(home.indexOf('const onPuff'), home.indexOf('const onUndo'));
    const selectMode = home.slice(home.indexOf('const selectMode'), home.indexOf('return ('));
    assert.ok(!/playSkipSound/.test(onUndo));
    assert.ok(!/playSkipSound/.test(onUndoSkip));
    assert.ok(!/playSkipSound/.test(onPuff));
    assert.ok(!/playSkipSound/.test(selectMode));
    assert.match(onPuff, /playPuffSound\(\)/);
  });

  test('Settings sound toggle still previews the puff sound, not Skip', () => {
    const settings = read('src', 'screens', 'SettingsScreen.tsx');
    assert.match(settings, /if \(soundEnabled\) playPuffSound\(\)/);
    assert.ok(!/playSkipSound/.test(settings));
  });
});
