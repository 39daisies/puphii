import { pluralize } from '../utils/format';

/** Chart accent family: coral for puffs, seafoam mint for skips. */
export type BarTone = 'coral' | 'mint';

export type Bar = {
  key: string;
  value: number;
  label: string;
  sublabel?: string;
  highlight?: boolean;
  /** Not reached yet: drawn as an empty slot rather than as zero. */
  future?: boolean;
  /** Spoken description, e.g. "Monday October 5". */
  spokenLabel: string;
  /** Optional daily target, drawn as a line across the column. */
  target?: number | null;
  /** A finished day with nothing recorded: drawn as an empty slot and never as zero. */
  untracked?: boolean;
  /** Replaces the spoken count, e.g. "plan paused, 3 logged puffs". */
  spokenValue?: string;
  /** Defaults to coral (puffs). Use mint for skip charts. */
  tone?: BarTone;
};

/** Tallest value the chart scales to: bars, plus targets where given. */
export const chartMax = (data: readonly Bar[]): number =>
  Math.max(1, ...data.map((bar) => (bar.future || bar.untracked ? 0 : bar.value)), ...data.map((bar) => bar.target ?? 0));

export const spokenBar = (bar: Bar) => {
  const value = bar.spokenValue ?? (bar.future ? 'not yet' : bar.untracked ? 'no activity recorded' : pluralize(bar.value, 'logged puff'));
  return `${bar.spokenLabel}: ${value}${bar.target != null ? `, daily target ${bar.target}` : ''}`;
};

/** Distance of a target line from the bottom of the plot. */
export const targetOffset = (target: number, max: number, height: number): number => (target <= 0 ? 0 : (Math.min(target, max) / max) * height);
