import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { inflateSync } from 'node:zlib';
import { createReactionTimer, Scheduler } from '../src/mascot/reactionTimer';
import {
  BOB_AMPLITUDE,
  BUBBLE_CYCLE_MS,
  DIGIT_WIDTH,
  FISH_CYCLE_MS,
  FRONT_OPACITY,
  Keyframes,
  MASCOT_FRAME_H,
  MASCOT_FRAME_W,
  PLATE_PADDING,
  REEF_BUBBLES,
  REEF_FISH,
  reefLayout,
  sample,
  SCENE_INSET,
  settleSwim,
  sineKeys,
  SWAP_WINDOW,
  SWIM_CYCLE_MS,
  SWIM_KEYS,
  SWIM_MOMENTS,
  SWIM_REST,
  TURN_EDGE,
  verticalRange,
  wrapKeys,
} from '../src/mascot/reefMotion';

const ROOT = join(__dirname, '..', '..');
const read = (...path: string[]) => readFileSync(join(ROOT, ...path), 'utf8');
const FRAME_MS = 1000 / 60;

/** Samples the swim cycle finely enough to land inside every sprite-swap window. */
const STEPS = 200_000;
const swimSamples = Array.from({ length: STEPS + 1 }, (_, i) => i / STEPS);

const sideOpacity = (t: number) => sample(SWIM_KEYS.profileOpacity, t);
const frontOpacity = (t: number) => sample(FRONT_OPACITY, t);

describe('reef choreography keyframes', () => {
  const tables: [string, Keyframes][] = [
    ...Object.entries(SWIM_KEYS),
    ['frontOpacity', FRONT_OPACITY],
    ['sine', sineKeys(3)],
    ...[...REEF_FISH, ...REEF_BUBBLES].map((spec, i): [string, Keyframes] => [`wrap ${i}`, wrapKeys(spec.phase)]),
  ];

  test('every input range is strictly increasing and spans the whole clock', () => {
    for (const [name, keys] of tables) {
      assert.equal(keys.inputRange.length, keys.outputRange.length, name);
      assert.equal(keys.inputRange[0], 0, name);
      assert.equal(keys.inputRange[keys.inputRange.length - 1], 1, name);
      for (let i = 1; i < keys.inputRange.length; i += 1) {
        assert.ok(keys.inputRange[i] > keys.inputRange[i - 1], `${name} at ${i}`);
      }
      assert.ok(keys.outputRange.every(Number.isFinite), name);
    }
  });

  test('the swim loops seamlessly: every property ends where it starts', () => {
    for (const [name, keys] of Object.entries(SWIM_KEYS)) {
      assert.ok(Math.abs(sample(keys, 0) - sample(keys, 1)) < 1e-9, name);
    }
  });

  test('path values stay within the travel the layout allows', () => {
    for (const keys of [SWIM_KEYS.x, SWIM_KEYS.y, SWIM_KEYS.bob]) {
      assert.ok(Math.max(...keys.outputRange.map(Math.abs)) <= 1);
    }
  });

  test('wrapKeys shifts the clock by its phase, modulo 1', () => {
    for (const phase of [0, 0.25, 0.63]) {
      for (const t of [0, 0.1, 0.5, 0.9]) {
        const expected = (t + phase) % 1;
        assert.ok(Math.abs(sample(wrapKeys(phase), t) - expected) < 0.001, `${phase} @ ${t}`);
      }
    }
  });

  test('cycles are slow enough to read as gentle drifting', () => {
    assert.ok(SWIM_CYCLE_MS >= 10_000 && FISH_CYCLE_MS >= 15_000 && BUBBLE_CYCLE_MS >= 5_000);
  });
});

describe('no ghosting between the side-on and front-facing sprites', () => {
  test('exactly one sprite is fully visible except within sub-frame swap windows', () => {
    let partial = 0;
    for (const t of swimSamples) {
      const side = sideOpacity(t);
      const front = frontOpacity(t);
      assert.ok(Math.abs(side + front - 1) < 1e-9, `opacities sum to 1 at ${t}`);
      if (side > 0 && side < 1) partial += 1;
    }
    assert.ok((partial / STEPS) * SWIM_CYCLE_MS < FRAME_MS, 'a swap lasts less than one frame');
    assert.ok(SWAP_WINDOW * SWIM_CYCLE_MS < FRAME_MS);
  });

  test('sprites swap only when both are squeezed to the edge of a turn', () => {
    for (const t of swimSamples) {
      const side = sideOpacity(t);
      if (side > 0 && side < 1) {
        assert.ok(Math.abs(sample(SWIM_KEYS.profileScaleX, t)) <= TURN_EDGE + 1e-9, `side scale at ${t}`);
        assert.ok(Math.abs(sample(SWIM_KEYS.frontScaleX, t)) <= TURN_EDGE + 1e-9, `front scale at ${t}`);
      }
    }
  });

  test('the visible sprite only gets thinner than a turn edge while flipping, for under a frame', () => {
    let thin = 0;
    for (const t of swimSamples) {
      const scale = sideOpacity(t) >= 0.5 ? sample(SWIM_KEYS.profileScaleX, t) : sample(SWIM_KEYS.frontScaleX, t);
      if (Math.abs(scale) < TURN_EDGE - 1e-9) {
        thin += 1;
        assert.ok(Math.abs(t - SWIM_MOMENTS.turnRightEnd / 2) <= SWAP_WINDOW / 2 + 1e-9, `thin only mid-flip, not at ${t}`);
      }
    }
    assert.ok((thin / STEPS) * SWIM_CYCLE_MS < FRAME_MS);
  });

  test('Puphii turns toward the viewer once per cycle, for long enough to notice', () => {
    let entries = 0;
    let fullFrontMs = 0;
    for (let i = 1; i < swimSamples.length; i += 1) {
      const t = swimSamples[i];
      if (frontOpacity(t) === 1 && frontOpacity(swimSamples[i - 1]) < 1) entries += 1;
      if (frontOpacity(t) === 1 && sample(SWIM_KEYS.frontScaleX, t) === 1) fullFrontMs += SWIM_CYCLE_MS / STEPS;
    }
    assert.equal(entries, 1);
    assert.ok(fullFrontMs >= 1500 && fullFrontMs <= 3000, `${fullFrontMs} ms`);
  });

  test('the side-on sprite faces the way Puphii is swimming', () => {
    // The artwork faces left, so a negative scaleX faces right.
    const { swimRightEnd, turnRightEnd, profileFull } = SWIM_MOMENTS;
    for (let t = turnRightEnd + 0.01; t < swimRightEnd; t += 0.01) {
      assert.ok(sample(SWIM_KEYS.x, t + 0.005) > sample(SWIM_KEYS.x, t), 'moving right');
      assert.equal(sample(SWIM_KEYS.profileScaleX, t), -1);
    }
    for (let t = profileFull + 0.01; t < 0.995; t += 0.01) {
      assert.ok(sample(SWIM_KEYS.x, t + 0.004) < sample(SWIM_KEYS.x, t), 'moving left');
      assert.equal(sample(SWIM_KEYS.profileScaleX, t), 1);
    }
  });
});

describe('pausing and Reduce Motion', () => {
  const visibleScale = (t: number) =>
    sideOpacity(t) === 1 ? Math.abs(sample(SWIM_KEYS.profileScaleX, t)) : Math.abs(sample(SWIM_KEYS.frontScaleX, t));

  test('a paused swim never freezes mid-turn', () => {
    for (let i = 0; i <= 2000; i += 1) {
      const settled = settleSwim(i / 2000, false);
      assert.ok(sideOpacity(settled) === 1 || frontOpacity(settled) === 1, `one sprite at ${settled}`);
      assert.equal(visibleScale(settled), 1, `full width when paused at ${i / 2000}`);
    }
  });

  test('settling is a no-op during plain swimming, so Resume continues from the same spot', () => {
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) assert.equal(settleSwim(t, false), t);
  });

  test('with Reduce Motion, Puphii rests facing the viewer, happy, at full size', () => {
    for (const t of [0, 0.2, 0.44, 0.99]) assert.equal(settleSwim(t, true), SWIM_REST);
    assert.equal(frontOpacity(SWIM_REST), 1);
    assert.equal(sample(SWIM_KEYS.frontScaleX, SWIM_REST), 1);
  });
});

describe('reef layout', () => {
  // Inner card widths: iPhone SE / mini, iPhone 13 / 14 / 15, Plus / Pro Max, tablet cap.
  const widths = [278, 333, 348, 388, 398];
  const heights = [667, 750, 844, 932];

  test('the count plate and Puphii lane never overlap and fit inside the card', () => {
    for (const sceneWidth of widths) {
      for (const screenHeight of heights) {
        for (let digits = 1; digits <= 5; digits += 1) {
          const l = reefLayout({ sceneWidth, screenHeight, digits });
          const label = `${sceneWidth}×${screenHeight}, ${digits} digits`;
          assert.ok(l.laneLeft >= SCENE_INSET + l.plateWidth, label);
          assert.ok(l.laneLeft + l.laneWidth <= sceneWidth, label);
          assert.ok(l.mascotSize * MASCOT_FRAME_W + l.swimRange * 2 <= l.laneWidth + 1e-9, `Puphii stays in the lane: ${label}`);
          assert.ok(l.swimRange >= 0, label);
          const shown = Math.max(2, digits);
          assert.ok(shown * DIGIT_WIDTH * l.countSize <= l.plateWidth - PLATE_PADDING * 2 + 1e-9, `digits fit the plate: ${label}`);
        }
      }
    }
  });

  test('on iPhone 13 the count stays as prominent as before and Puphii has room to swim', () => {
    const l = reefLayout({ sceneWidth: 348, screenHeight: 844, digits: 2 });
    assert.ok(l.countSize >= 90, `count ${l.countSize}`);
    assert.ok(l.mascotSize >= 90, `mascot ${l.mascotSize}`);
    assert.ok(l.swimRange >= 16, `swim ${l.swimRange}`);
    assert.ok(reefLayout({ sceneWidth: 348, screenHeight: 844, digits: 3 }).countSize >= 60, 'three digits stay large');
  });

  test('Puphii is never clipped at the top or bottom of the scene, including the bob', () => {
    for (const sceneWidth of widths) {
      for (const screenHeight of heights) {
        const l = reefLayout({ sceneWidth, screenHeight, digits: 2 });
        for (const sceneHeight of [l.sceneMinHeight, l.sceneMinHeight + 80]) {
          const rise = verticalRange(sceneHeight, l.mascotSize);
          assert.ok(l.mascotSize * MASCOT_FRAME_H + (rise + BOB_AMPLITUDE) * 2 <= sceneHeight, `${sceneWidth}×${screenHeight}`);
        }
      }
    }
  });
});

describe('reaction timing', () => {
  function fakeScheduler() {
    let now = 0;
    const timers = new Map<number, { at: number; callback: () => void }>();
    let id = 0;
    const scheduler: Scheduler = {
      set: (callback, ms) => {
        id += 1;
        timers.set(id, { at: now + ms, callback });
        return id;
      },
      clear: (handle) => {
        timers.delete(handle as number);
      },
    };
    const advance = (ms: number) => {
      now += ms;
      for (const [key, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at <= now) {
          timers.delete(key);
          timer.callback();
        }
      }
    };
    return { scheduler, advance, pending: () => timers.size };
  }

  test('rapid logs keep a single pending reaction, and only the latest returns Puphii to idle', () => {
    const { scheduler, advance, pending } = fakeScheduler();
    const timer = createReactionTimer(scheduler);
    const ended: string[] = [];
    timer.restart(850, () => ended.push('first'));
    advance(200);
    timer.restart(850, () => ended.push('second'));
    advance(200);
    timer.restart(850, () => ended.push('third'));
    assert.equal(pending(), 1);
    advance(700);
    assert.deepEqual(ended, [], 'an older timer never cuts the newest reaction short');
    advance(200);
    assert.deepEqual(ended, ['third']);
    assert.equal(timer.pending, false);
  });

  test('undo straight after a log replaces the log reaction', () => {
    const { scheduler, advance, pending } = fakeScheduler();
    const timer = createReactionTimer(scheduler);
    const ended: string[] = [];
    timer.restart(1000, () => ended.push('log'));
    advance(100);
    timer.restart(700, () => ended.push('undo'));
    assert.equal(pending(), 1);
    advance(1000);
    assert.deepEqual(ended, ['undo']);
  });

  test('a stale callback that fires anyway is ignored, and cancel clears everything', () => {
    let stale: (() => void) | null = null;
    let id = 0;
    const leaky: Scheduler = { set: (callback) => ((stale = callback), (id += 1)), clear: () => undefined };
    const timer = createReactionTimer(leaky);
    let calls = 0;
    timer.restart(500, () => (calls += 1));
    const first = stale as unknown as () => void;
    timer.restart(500, () => (calls += 10));
    first();
    assert.equal(calls, 0);
    timer.cancel();
    assert.equal(timer.pending, false);
  });
});

/** Minimal PNG reader: 8-bit RGBA, non-interlaced. Returns alpha per pixel. */
function readAlpha(path: string) {
  const data = readFileSync(join(ROOT, path));
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const idat: Buffer[] = [];
  while (pos < data.length) {
    const length = data.readUInt32BE(pos);
    const type = data.toString('latin1', pos + 4, pos + 8);
    const body = data.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      assert.equal(body[8], 8, `${path} is 8-bit`);
      colorType = body[9];
      assert.equal(body[12], 0, `${path} is not interlaced`);
    } else if (type === 'IDAT') idat.push(body);
    pos += 12 + length;
  }
  assert.equal(colorType, 6, `${path} has a real alpha channel`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const out = new Uint8Array(width * height);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x += 1) {
      const a = x >= 4 ? line[x - 4] : 0;
      const b = prev[x];
      const c = x >= 4 ? prev[x - 4] : 0;
      let add = 0;
      if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = (line[x] + add) & 255;
    }
    for (let x = 0; x < width; x += 1) out[y * width + x] = line[x * 4 + 3];
    prev = line;
  }
  return { width, height, alpha: out };
}

function opaqueBox(path: string) {
  const { width, height, alpha } = readAlpha(path);
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (alpha[y * width + x] > 16) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
  }
  const corners = [0, width - 1, (height - 1) * width, height * width - 1].map((i) => alpha[i]);
  const edge = Math.max(...Array.from({ length: width }, (_, x) => Math.max(alpha[x], alpha[(height - 1) * width + x])));
  return { width, height, cx: (x0 + x1) / 2 / width, cy: (y0 + y1) / 2 / height, h: (y1 - y0) / height, corners, edge };
}

describe('bundled reef assets', () => {
  const idle = opaqueBox('assets/puffy/idle.png');

  for (const sprite of ['assets/puffy/swim_happy.png', 'assets/puffy/front_happy.png']) {
    test(`${sprite} shares the reaction faces' canvas, so expression changes don't jump`, () => {
      const box = opaqueBox(sprite);
      assert.deepEqual([box.width, box.height], [idle.width, idle.height]);
      assert.deepEqual(box.corners, [0, 0, 0, 0], 'transparent corners: no background rectangle');
      assert.equal(box.edge, 0, 'nothing touches the canvas edge, so nothing is clipped');
      assert.ok(Math.abs(box.cx - idle.cx) < 0.04, `centred horizontally (${box.cx})`);
      assert.ok(Math.abs(box.cy - idle.cy) < 0.04, `centred vertically (${box.cy})`);
      assert.ok(Math.abs(box.h - idle.h) < 0.05, `same height (${box.h} vs ${idle.h})`);
    });
  }

  test('the smoky squint face is a transparent sprite on the reaction faces\' canvas', () => {
    const box = opaqueBox('assets/puffy/smoky_squint.png');
    assert.deepEqual([box.width, box.height], [idle.width, idle.height]);
    assert.deepEqual(box.corners, [0, 0, 0, 0], 'the black background was removed');
    assert.equal(box.edge, 0, 'the smoke is not clipped by the canvas edge');
    const { alpha } = readAlpha('assets/puffy/smoky_squint.png');
    assert.ok(alpha.some((a) => a > 16 && a < 200), 'the smoke stays translucent');
    assert.match(read('src', 'mascot', 'faces.ts'), /smokySquint: require\('\.\.\/\.\.\/assets\/puffy\/smoky_squint\.png'\)/);
  });

  test('the app icon is a 1024 px opaque PNG set in app.json', () => {
    const png = readFileSync(join(ROOT, 'assets/icon.png'));
    assert.equal(png.toString('latin1', 1, 4), 'PNG');
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1024, 1024]);
    assert.equal(png[25], 2, 'RGB without an alpha channel, as App Store icons require');
    assert.equal(JSON.parse(read('app.json')).expo.icon, './assets/icon.png');
  });

  test('the reef photo is bundled locally and the scene loads nothing remote', () => {
    const jpeg = readFileSync(join(ROOT, 'assets/ocean/ocean-reef.jpg'));
    assert.equal(jpeg.readUInt16BE(0), 0xffd8);
    const scene = read('src', 'components', 'ReefScene.tsx');
    assert.match(scene, /require\('\.\.\/\.\.\/assets\/ocean\/ocean-reef\.jpg'\)/);
    assert.ok(!/https?:\/\//.test(scene));
  });
});

describe('Home wiring', () => {
  const home = read('src', 'screens', 'HomeScreen.tsx');
  const scene = read('src', 'components', 'ReefScene.tsx');
  const clock = read('src', 'hooks', 'useLoopClock.ts');

  test('a log is recorded before, and independently of, any animation', () => {
    const onPuff = home.slice(home.indexOf('const onPuff'), home.indexOf('const onUndo'));
    assert.ok(onPuff.indexOf('addPuff()') < onPuff.indexOf('mascotRef.current?.react'));
    assert.ok(!/await|setTimeout|Animated/.test(onPuff), 'logging never waits for an animation');
    const onUndo = home.slice(home.indexOf('const onUndo'), home.indexOf('const statusText'));
    assert.ok(onUndo.indexOf('undoLatestToday()') < onUndo.indexOf('mascotRef.current?.relieve'));
  });

  test('motion stops in the background, when paused and with Reduce Motion', () => {
    assert.match(home, /const animating = appActive && !motionPaused && !reduceMotion;/);
    assert.match(home, /<ReefBackdrop [^>]*running=\{animating\}/);
    assert.match(home, /<SwimmingPuphii [^>]*running=\{animating\} still=\{reduceMotion\}/);
  });

  test('loops are cleaned up and never hold InteractionManager open', () => {
    assert.match(clock, /isInteraction: false/);
    assert.match(clock, /return \(\) => \{\s*active = false;\s*animation\?\.stop\(\);/);
  });

  test('the pause control is a labelled 44 pt target and is hidden when there is no motion', () => {
    assert.match(home, /accessibilityLabel=\{motionPaused \? 'Resume ocean animation' : 'Pause ocean animation'\}/);
    assert.match(home, /hitSlop=\{\(TOUCH_TARGET - MOTION_BUTTON_HEIGHT\) \/ 2\}/);
    assert.match(home, /\{reduceMotion \? null : \(/);
  });

  test('idle uses only the happy sprites; stronger faces stay in the chosen reaction mode', () => {
    assert.match(scene, /SWIM_SPRITES\.side/);
    assert.match(scene, /SWIM_SPRITES\.front/);
    assert.ok(!/FACES\.|REACTIONS/.test(scene), 'the scene never picks a reaction face itself');
    const faces = read('src', 'mascot', 'faces.ts');
    assert.match(faces, /minimal: \{ faces: \['curious', 'winking'\], duration: 550 \}/);
    assert.match(faces, /expressive: \{ faces: \['coughing', 'annoyed', 'exasperated', 'smokySquint'\], duration: 850 \}/);
    assert.match(faces, /dramatic: \{ faces: \['furiousSteam', 'dizzy'\], duration: 1000 \}/);
  });

  test('the scene is decorative to screen readers, apart from Puphii and the count', () => {
    assert.match(scene, /accessibilityElementsHidden\s+importantForAccessibility="no-hide-descendants"/);
    assert.match(home, /accessibilityLabel=\{`Today's count: \$\{pluralize\(todayCount, 'puff'\)\}`\}/);
  });
});
