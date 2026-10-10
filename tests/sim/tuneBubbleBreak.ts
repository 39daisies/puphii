/**
 * Compares Bubble Break configurations with simulated players and prints the results.
 * Run with `npm run simulate`. Optional: `npm run simulate -- 400` for more rounds.
 */
import { StageName } from '../../src/game/bubbleBreak';
import { CANDIDATES } from './candidates';
import { FIELDS, movementStats, PLAYERS, simulate } from './playerSim';

const rounds = Number(process.argv[2]) || 200;
const pct = (value: number) => `${Math.round(value * 100)}%`.padStart(4);
const STAGES: StageName[] = ['warm-up', 'build', 'challenge', 'finish'];

console.log(`Bubble Break tuning — ${rounds} simulated rounds per player per configuration, 390 pt phone.\n`);
console.log('Pop rate by stage (escaped in brackets): warm-up 0–5 s | build 5–10 s | challenge 10–20 s | finish 20–30 s\n');

for (const candidate of CANDIDATES) {
  console.log(`■ ${candidate.name} — ${candidate.note}`);
  for (const player of PLAYERS) {
    const s = simulate({ tuning: candidate.tuning, player, rounds });
    const stages = STAGES.map((name) => `${pct(s.stages[name].popRate)} (${pct(s.stages[name].escapeRate)})`).join(' | ');
    console.log(
      `  ${player.name.padEnd(8)} score ${s.score.toFixed(1).padStart(5)} of ${s.spawned.toFixed(1).padStart(5)}  ` +
        `popped ${pct(s.popRate)}  escaped ${pct(s.escapeRate)}  tap accuracy ${pct(s.tapAccuracy)}  │ ${stages}`,
    );
  }
  const movement = movementStats(candidate.tuning, 40);
  for (const name of STAGES) {
    const m = movement[name];
    console.log(
      `    ${name.padEnd(9)} on screen ${(m.travelMs / 1000).toFixed(2)} s (fastest 10% ≤${(m.travelP10 / 1000).toFixed(2)} s, ` +
        `slowest 10% ≥${(m.travelP90 / 1000).toFixed(2)} s)  ${m.onScreen.toFixed(1)} at once  ` +
        `speed spread ${m.speedSpread.toFixed(2)}  reverse sideways ${pct(m.reversals)}  250 ms guess off by ${m.predictionError.toFixed(1)} pt  sync ${m.sync.toFixed(2)}`,
    );
  }
  console.log('');
}

console.log('Aiming sensitivity — players who commit to a spot 220 ms before the finger lands (less late correction):');
for (const name of ['original', 'round one', 'new (default)']) {
  const tuning = CANDIDATES.find((c) => c.name === name)!.tuning;
  const row = PLAYERS.map((player) => {
    const s = simulate({ tuning, player: { ...player, lockMs: 220 }, rounds });
    return `${player.name} tap accuracy ${pct(s.tapAccuracy)}, finish ${pct(s.stages.finish.popRate)}`;
  });
  console.log(`  ${name.padEnd(22)} ${row.join('  │  ')}`);
}
console.log('');

console.log('Small phone (320 pt) with the shipped tuning:');
for (const player of PLAYERS) {
  const s = simulate({ tuning: CANDIDATES.find((c) => c.name === 'new (default)')!.tuning, player, rounds, field: FIELDS.phone320 });
  const stages = STAGES.map((name) => `${pct(s.stages[name].popRate)} (${pct(s.stages[name].escapeRate)})`).join(' | ');
  console.log(`  ${player.name.padEnd(8)} score ${s.score.toFixed(1).padStart(5)} of ${s.spawned.toFixed(1).padStart(5)}  popped ${pct(s.popRate)}  │ ${stages}`);
}
