import { DEFAULT_GAME_STATS, GameStats } from '../game/gameStats';
import { defaultPlan, PlanRecord } from '../plan/model';
import { defaultSavings, SavingsSettings } from './savings';
import { STORAGE_KEYS, USER_DATA_KEYS } from './storageKeys';
import { DEFAULT_SETTINGS, PuffLog, Settings } from './types';

/**
 * "Reset everything" scope. User data returns to defaults and its set-aside copies are
 * deleted. Lifecycle state and the schema marker are app records, not personal data, and
 * stay. Pep Rallies are reset by their controller, which also deletes their media files
 * with `deleteRecordingFiles`.
 */
export const RESET_KEYS = USER_DATA_KEYS;
export const KEPT_ON_RESET = [STORAGE_KEYS.appState, STORAGE_KEYS.schema] as const;

export type ResetValues = { logs: PuffLog[]; settings: Settings; savings: SavingsSettings; gameStats: GameStats; plan: PlanRecord };

export function resetValues(currency: string): ResetValues {
  return {
    logs: [],
    settings: { ...DEFAULT_SETTINGS },
    savings: defaultSavings(currency),
    gameStats: { ...DEFAULT_GAME_STATS },
    plan: defaultPlan(),
  };
}
