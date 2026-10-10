import { withUnknownFields } from '../data/preserve';

/** On-device Bubble Break record. Only finished rounds count; leaving early isn't recorded. */
export type GameStats = {
  roundsCompleted: number;
  bestScore: number;
};

export const DEFAULT_GAME_STATS: GameStats = { roundsCompleted: 0, bestScore: 0 };

const MAX_COUNT = 1_000_000;

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? Math.min(value, MAX_COUNT) : 0;

export function sanitizeGameStats(raw: unknown): GameStats {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_GAME_STATS };
  const value = raw as Record<string, unknown>;
  return withUnknownFields(raw, { roundsCompleted: count(value.roundsCompleted), bestScore: count(value.bestScore) });
}

export function recordRound(stats: GameStats, score: number): GameStats {
  const safeScore = count(score);
  return {
    ...stats,
    roundsCompleted: Math.min(stats.roundsCompleted + 1, MAX_COUNT),
    bestScore: Math.max(stats.bestScore, safeScore),
  };
}
