/**
 * What was consumed when the puff was logged. Absent on legacy records — treat as `unknown`
 * at read time; never invent a type for older entries.
 */
export type PuffProduct = 'vape' | 'cigarette' | 'unknown';

/** Counting unit for that product. Absent on legacy records — treat as `unknown`. */
export type PuffUnit = 'puff' | 'cigarette' | 'unknown';

export type PuffLog = {
  id: string;
  /** ISO-8601 instant. Local calendar day is derived at read time from the device time zone. */
  timestamp: string;
  /** Set on new logs from the savings product type. Omitted on legacy data. */
  product?: PuffProduct;
  unit?: PuffUnit;
};

/** An urge the person chose not to act on, logged by them. Never counted as a puff. */
export type SkipLog = {
  id: string;
  /** ISO-8601 instant, like a puff log. */
  timestamp: string;
};

/** Anything counted by calendar day: puffs or skips. */
export type TimedEvent = { timestamp: string };

export type ReactionMode = 'minimal' | 'expressive' | 'dramatic';

export const REACTION_MODES: readonly ReactionMode[] = ['minimal', 'expressive', 'dramatic'];

export type Settings = {
  mode: ReactionMode;
  soundEnabled: boolean;
  hapticsEnabled: boolean;
  remindersEnabled: boolean;
  reminderHour: number;
  reminderMinute: number;
};

export const DEFAULT_SETTINGS: Settings = {
  mode: 'expressive',
  soundEnabled: false,
  hapticsEnabled: true,
  remindersEnabled: false,
  reminderHour: 20,
  reminderMinute: 0,
};
