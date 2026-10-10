export type PuffLog = {
  id: string;
  /** ISO-8601 instant. Local calendar day is derived at read time from the device time zone. */
  timestamp: string;
};

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
