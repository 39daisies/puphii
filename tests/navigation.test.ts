import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { FrameScheduler, RoundState } from '../src/game/bubbleBreak';
import { createRoundSession } from '../src/game/roundSession';
import { STORAGE_KEYS } from '../src/data/storageKeys';
import { seeded } from './sim/playerSim';

const ROOT = join(__dirname, '..', '..');
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');

/** A manual frame clock: nothing runs until the test calls `frame`. */
function fakeScheduler() {
  let now = 0;
  let nextHandle = 1;
  const pending = new Map<number, () => void>();
  const scheduler: FrameScheduler = {
    now: () => now,
    request: (callback) => {
      const handle = nextHandle++;
      pending.set(handle, callback);
      return handle;
    },
    cancel: (handle) => {
      pending.delete(handle as number);
    },
  };
  return {
    scheduler,
    pendingCount: () => pending.size,
    wait: (ms: number) => {
      now += ms;
    },
    frame: (ms = 16) => {
      now += ms;
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((callback) => callback());
    },
  };
}

function session() {
  const clock = fakeScheduler();
  const recorded: number[] = [];
  const round = createRoundSession({ scheduler: clock.scheduler, random: seeded(11), onEnd: (score) => recorded.push(score) });
  return { clock, recorded, round, controller: round.controller };
}

describe('bottom navigation', () => {
  const tabBar = read('src', 'components', 'TabBar.tsx');
  const app = read('App.tsx');

  test('four tabs in order: Home, Insights, Play, You', () => {
    assert.match(tabBar, /export type TabKey = 'home' \| 'insights' \| 'play' \| 'you';/);
    const entries = [...tabBar.matchAll(/\{ key: '(\w+)', label: '([^']+)', icon: '(\w+)' \}/g)].map((match) => match.slice(1));
    assert.deepEqual(entries, [
      ['home', 'Home', 'home'],
      ['insights', 'Insights', 'history'],
      ['play', 'Play', 'gamepad'],
      ['you', 'You', 'user'],
    ]);
    assert.match(read('src', 'components', 'Icon.tsx'), /case 'gamepad':/);
  });

  test('tabs are announced as tabs, with their label and selected state', () => {
    assert.match(tabBar, /accessibilityRole="tablist"/);
    assert.match(tabBar, /accessibilityRole="tab"\s*accessibilityLabel=\{tab\.label\}\s*aria-selected=\{selected\}/);
    assert.match(tabBar, /minHeight: 52/, 'each tab is at least a 44 pt target');
  });

  test('the Play tab shows Bubble Break, and every tab returns to Home with Android back', () => {
    assert.match(app, /\{tab === 'play' && <PlayScreen sessions=\{playSessions\} \/>\}/);
    assert.match(app, /<TabBar active=\{tab\} onChange=\{setTab\} \/>/);
    assert.match(app, /if \(tab === 'home'\) return false;\s*setTab\('home'\);\s*return true;/);
    assert.ok(!/playing|setPlaying|BubbleBreakScreen|onOpenBubbleBreak/.test(app), 'Bubble Break no longer opens over another tab');
  });

  test('game sessions live above the tabs, so switching tabs never resets them', () => {
    assert.match(app, /const playSessions = usePlaySessions\(\);/);
    const play = read('src', 'screens', 'PlayScreen.tsx');
    assert.match(play, /export type PlayGame = 'bubbleBreak';/);
    assert.match(play, /<BubbleBreakScreen session=\{sessions\.bubbleBreak\} \/>/);
    assert.ok(!/Memory|voice|recording|microphone/i.test(play.replace(/\/\*\*[\s\S]*?\*\//g, '')), 'future games are not implemented yet');
  });

  test('Home no longer has a Bubble Break entry', () => {
    const home = read('src', 'screens', 'HomeScreen.tsx');
    assert.ok(!/Bubble Break|onOpenBubbleBreak|BubbleArt|playCard/.test(home));
  });
});

describe('Bubble Break in the Play tab', () => {
  const screen = read('src', 'screens', 'BubbleBreakScreen.tsx');

  test('keeps its title, and only tab-appropriate exits', () => {
    assert.match(screen, /accessibilityRole="header">\s*Bubble Break\s*<\/AppText>/);
    assert.ok(!/Leave Bubble Break/.test(screen), 'no close button on the start or results screen');
    assert.ok(!/Back to Home|onGoHome/.test(screen), 'the results stay within the Play tab');
  });

  test('results offer Play Again first and Done, which returns to the start screen', () => {
    const results = screen.slice(screen.indexOf("round.status === 'ended' ?"), screen.indexOf('Take a little pause.'));
    const again = results.indexOf('<PrimaryButton label="Play Again"');
    const done = results.indexOf('<SecondaryButton label="Done"');
    assert.ok(again > 0 && done > again, 'Play Again is the primary action, above Done');
    assert.match(results, /<PrimaryButton label="Play Again" accessibilityHint="Starts another 30-second round" onPress=\{start\} \/>/);
    assert.match(results, /<SecondaryButton label="Done" accessibilityHint="Returns to the Bubble Break start screen" onPress=\{controller\.reset\} \/>/);
  });

  test('End round pauses first and asks before discarding the round', () => {
    assert.match(screen, /<IconButton icon="close" accessibilityLabel="End round" onPress=\{askToEnd\} \/>/);
    assert.match(screen, /controller\.pause\(\);\s*if \(controller\.getState\(\)\.status === 'paused'\) setConfirmingEnd\(true\);/);
    assert.match(screen, /visible=\{confirmingEnd && round\.status === 'paused'\}/);
    assert.match(screen, /if \(round\.status !== 'paused'\) setConfirmingEnd\(false\);/, 'a round that resumes or ends drops the question');
    assert.match(screen, /title="End this round\?"/);
    assert.match(screen, /confirmLabel="End round"/);
    assert.match(screen, /onCancel=\{\(\) => setConfirmingEnd\(false\)\}/, 'Cancel only closes the question; the round stays paused');
    assert.match(screen, /setConfirmingEnd\(false\);\s*controller\.abandon\(\);/);
    assert.equal((screen.match(/controller\.abandon/g) ?? []).length, 1, 'nothing else ends a round early');
  });

  test('the screen attaches to the session, pauses in the background and owns no controller', () => {
    assert.match(screen, /useEffect\(\(\) => session\.attach\(setRound\), \[session\]\);/);
    assert.match(screen, /if \(next !== 'active'\) controller\.pause\(\);/);
    assert.ok(!/createRoundController|\.dispose\(\)/.test(screen));
  });

  test('scores are recorded through the same store call and stored under the same key', () => {
    assert.match(screen, /recordRef\.current\(score\);/);
    assert.equal(STORAGE_KEYS.game, '@puphii/bubble-break-v1');
  });

  test('no audio is involved, so there is nothing to stop between tabs', () => {
    assert.ok(!/expo-av|expo-audio|playPuffSound|Sound/.test(screen));
  });
});

describe('round session across tab switches', () => {
  test('leaving mid-round pauses it and stops the frame loop; returning shows it paused', () => {
    const { clock, round, controller } = session();
    const seen: RoundState[] = [];
    const detach = round.attach((state) => seen.push(state));
    assert.equal(seen.at(-1)?.status, 'ready', 'attaching shows the current round at once');
    controller.start();
    clock.frame(500);
    clock.frame(500);
    detach();
    assert.equal(controller.getState().status, 'paused');
    assert.equal(clock.pendingCount(), 0, 'no frames are scheduled while away');
    const elapsed = controller.getState().elapsed;

    clock.wait(60_000);
    const shown: RoundState[] = [];
    round.attach((state) => shown.push(state));
    assert.equal(shown[0].status, 'paused');
    assert.equal(shown[0].elapsed, elapsed, 'time away does not count');

    controller.resume();
    clock.frame(200);
    assert.equal(controller.getState().elapsed, elapsed + 200);
    assert.equal(shown.at(-1)?.status, 'playing');
  });

  test('a detached screen receives nothing more', () => {
    const { clock, round, controller } = session();
    let calls = 0;
    const detach = round.attach(() => {
      calls += 1;
    });
    controller.start();
    detach();
    const before = calls;
    controller.resume();
    clock.frame(16);
    assert.equal(calls, before);
    controller.pause();
  });

  test('a finished round is recorded once and stays on the results screen', () => {
    const { clock, round, controller, recorded } = session();
    const detach = round.attach(() => undefined);
    controller.start();
    for (let i = 0; i < 40; i += 1) clock.frame(1000);
    assert.equal(controller.getState().status, 'ended');
    assert.equal(recorded.length, 1);
    detach();
    assert.equal(controller.getState().status, 'ended', 'leaving the results does not change them');
    assert.equal(recorded.length, 1);
  });

  test('End round clears the round without recording a score', () => {
    const { clock, controller, recorded } = session();
    controller.start();
    clock.frame(1000);
    controller.abandon();
    assert.equal(controller.getState().status, 'ready');
    assert.equal(controller.getState().score, 0);
    assert.equal(clock.pendingCount(), 0);
    clock.frame(40_000);
    assert.deepEqual(recorded, []);

    controller.start();
    controller.pause();
    controller.abandon();
    assert.equal(controller.getState().status, 'ready', 'a paused round can be ended too');
    controller.abandon();
    assert.equal(controller.getState().status, 'ready', 'ending with no round does nothing');
  });

  test('cancelling End round leaves the round paused with its remaining time', () => {
    const { clock, controller, recorded } = session();
    controller.start();
    clock.frame(1000);
    clock.frame(4000);
    // Tapping End round pauses; the dialog is open while time passes, then Cancel changes nothing.
    controller.pause();
    const paused = controller.getState();
    clock.wait(20_000);
    clock.frame(16);
    assert.equal(controller.getState().status, 'paused');
    assert.equal(controller.getState().elapsed, paused.elapsed, 'the clock stood still while the question was open');
    assert.equal(controller.getState().score, paused.score);

    controller.resume();
    clock.frame(1000);
    assert.equal(controller.getState().elapsed, paused.elapsed + 1000, 'the round carries on from where it paused');
    assert.deepEqual(recorded, []);
  });

  test('confirming End round discards the paused round without a score', () => {
    const { clock, controller, recorded } = session();
    controller.start();
    clock.frame(1000);
    clock.frame(4000);
    controller.pause();
    controller.abandon();
    assert.equal(controller.getState().status, 'ready');
    assert.equal(clock.pendingCount(), 0);
    clock.frame(60_000);
    assert.deepEqual(recorded, []);
  });

  test('Done leaves the results for the start screen, without recording again', () => {
    const { clock, controller, recorded } = session();
    controller.reset();
    assert.equal(controller.getState().status, 'ready', 'Done does nothing before a round');
    controller.start();
    clock.frame(1000);
    controller.reset();
    assert.equal(controller.getState().status, 'playing', 'Done never ends a round in play');
    for (let i = 0; i < 40; i += 1) clock.frame(1000);
    assert.equal(controller.getState().status, 'ended');
    assert.equal(recorded.length, 1);

    controller.reset();
    assert.equal(controller.getState().status, 'ready');
    assert.equal(controller.getState().score, 0);
    assert.equal(clock.pendingCount(), 0);
    assert.equal(recorded.length, 1, 'the finished round was recorded once, when it ended');

    controller.start();
    assert.equal(controller.getState().status, 'playing', 'a new round starts from the start screen');
    controller.pause();
  });
});
