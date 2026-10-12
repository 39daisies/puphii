import { Bar } from '../../components/barChartModel';
import { spokenPlanDay } from '../../plan/copy';
import { DayKey } from '../../plan/days';
import { PlanDay } from '../../plan/progress';
import { formatFullDay, formatLongDate, formatMonthDay, formatWeekday } from '../../utils/format';

/** A day key as a local date at noon, for formatting. */
export const dayDate = (day: DayKey): Date => {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date, 12);
};
export const longDay = (day: DayKey) => formatLongDate(dayDate(day));
export const monthDay = (day: DayKey) => formatMonthDay(dayDate(day));

/**
 * Plan days as chart bars. Untracked days are empty slots, never zero-height bars, and each bar's
 * spoken text says what the day was, so nothing relies on color.
 */
export const planBars = (days: readonly PlanDay[], today: DayKey): Bar[] =>
  days.map((day) => ({
    key: day.day,
    value: day.count,
    label: formatWeekday(dayDate(day.day)),
    spokenLabel: formatFullDay(dayDate(day.day)),
    highlight: day.day === today,
    future: day.status === 'future',
    untracked: day.status === 'untracked',
    target: day.target,
    spokenValue: spokenPlanDay(day),
  }));
