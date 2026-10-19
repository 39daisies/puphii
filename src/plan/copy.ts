/**
 * Every line of plan wording. Neutral and factual: no shame, no streaks, no health claims, and
 * nothing that frames a target as an amount to reach. Checked by tests/planCopy.test.ts.
 */

import { PlanError } from './actions';
import { HistoryBaseline } from './baseline';
import { BaselineSource, MilestoneId, PacePreset, PlanGoal } from './model';
import { DayStatus, TodayProgress, WeekSummary } from './progress';
import { weekNumber } from './schedule';

const puffs = (count: number) => `${count} ${count === 1 ? 'puff' : 'puffs'}`;
const days = (count: number) => `${count} ${count === 1 ? 'day' : 'days'}`;
const decimal = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

export const GOAL_COPY: Record<PlanGoal, { label: string; description: string }> = {
  track: { label: 'Just track', description: 'Log puffs and see your patterns, with no daily target.' },
  reduce: { label: 'Cut down', description: 'A daily target that eases down at a pace you choose, then settles at a level you pick.' },
  quit: { label: 'Work toward quitting', description: 'A daily target that eases down toward zero at a pace you choose.' },
};

export const PACE_LABELS: Record<PacePreset, string> = { gentle: 'Gentle', steady: 'Steady', faster: 'Faster', custom: 'Custom' };

export const PACE_DISCLAIMER =
  "These paces are examples, not medical advice. No pace is right for everyone, and you can change yours at any time.";

export const paceDescription = (baselinePerDay: number, percent: number): string =>
  `Each week, the daily target drops by about ${decimal(Math.round(baselinePerDay * percent) / 100)} (${percent}% of your starting level).`;

export function baselineSummary(result: HistoryBaseline): string {
  if (result.status === 'ok') {
    const gaps = result.untrackedDays > 0 ? " Days with no activity recorded aren't counted." : '';
    return `About ${decimal(result.perDay)} a day, based on ${days(result.trackedDays)} you tracked in the last two weeks.${gaps}`;
  }
  if (result.status === 'zero') return 'Every day you tracked in the last two weeks was confirmed puff-free, so there is no starting level to work from.';
  return `Puphii needs at least ${days(result.needed)} tracked in the last two weeks to suggest a starting point. You can enter your own estimate instead.`;
}

export const ESTIMATE_HINT = 'A rough count for a typical day is fine. You can change it later.';

/** Plan weeks are counted from 0 in the logic; people see the first week as Week 1. */
export const planWeekLabel = (week: number): string => `Week ${weekNumber(week)}`;

/** `week` is the plan week (from 0) from `weekReachingSettle`. Always conditional: a schedule, not an outcome. */
export const settleLine = (settleAt: number, week: number | null): string =>
  week === null
    ? 'At this pace, the target stays where it starts.'
    : week === 0
      ? `The target starts at ${settleAt} a day.`
      : `If you follow this pace, the daily target would reach ${settleAt} in ${planWeekLabel(week)}.`;

export const KEPT_ON_CHANGE = 'Your logs and milestones are kept.';
export const PLAN_TAGLINE = 'Your plan, your pace.';
export const ADJUST_ANYTIME = 'You can adjust your plan anytime.';
export const PLAN_INTRO = 'Choose what you want from Puphii. Logging works the same whichever you pick.';
export const TRACK_ONLY_NOTE = 'Puphii keeps counting as usual, with no daily target. You can set a goal here anytime.';
export const previousPlanNote = (endedOn: string): string => `Your last plan ended on ${endedOn}. Its milestones are kept below.`;

export const GOAL_QUESTION = 'What would you like to do?';
export const BASELINE_TITLE = 'Starting point';
export const BASELINE_SOURCE_LABEL: Record<BaselineSource, string> = {
  history: 'Calculated from tracked activity',
  estimate: 'Your estimate',
};
export const USE_HISTORY_LABEL = 'Use my tracked activity';
export const USE_ESTIMATE_LABEL = 'Enter my own estimate';
export const ESTIMATE_LABEL = 'Puffs on a typical day';
export const startingLevel = (perDay: number): string => `About ${decimal(perDay)} a day`;

/**
 * Where the plan's starting level came from. A level calculated from logs that are no longer all
 * there (such as after clearing puff history) is described as such, never as currently verified.
 */
export function baselineProvenanceNote(source: BaselineSource, checkable: boolean, since: string): string {
  if (source === 'estimate') return 'A number you entered, not calculated from your logs.';
  if (checkable) return `From the days you tracked in the two weeks before ${since}. Days with no activity recorded weren't counted.`;
  return `Calculated from the days you tracked in the two weeks before ${since}. Your records for those days have changed since, for example after clearing puff history, so this number can't be rechecked from your current logs. Your plan keeps using it.`;
}

export const PACE_TITLE = 'Pace';
export const paceLabel = (preset: PacePreset, percent: number): string => `${PACE_LABELS[preset]} · ${percent}% a week`;
export const CUSTOM_PACE_HINT = 'Between 1% and 50% of your starting level each week.';

export const SETTLE_TITLE = 'Settle at';
export const SETTLE_HINT = 'The daily target stops easing down at this level.';
export const settleDetail = (goal: 'reduce' | 'quit', settleAt: number): string =>
  goal === 'quit' ? 'Eases toward 0' : `Settles at ${settleAt} a day`;

export const PREVIEW_TITLE = 'What this looks like';
export const PREVIEW_CAVEAT = 'This is a schedule of daily targets, not a prediction. You can change it anytime.';
export const previewRowLabel = (week: number, settles: boolean): string => (settles ? `${planWeekLabel(week)} onward` : planWeekLabel(week));
export const perDay = (target: number): string => `${target} a day`;
export const START_PLAN_LABEL = 'Start my plan';
export const PLAN_STARTED_NOTICE = `Your plan has started. ${ADJUST_ANYTIME}`;

export const TODAY_TITLE = 'Today';
export const planWeekLine = (week: number, paused: boolean): string => (paused ? `Week ${week} · paused` : `Week ${week} of your plan`);
export const nextChangeLine = (target: number, date: string): string => `From ${date}, the daily target will be ${target}.`;
export const settledLine = (goal: 'reduce' | 'quit'): string =>
  goal === 'quit' ? 'Your daily target is 0 and stays there.' : 'Your daily target is at your settle level and stays there.';
export const REMOVE_CONFIRMATION_LABEL = 'Remove "No puffs today"';

export const WEEK_CHART_TITLE = 'This week';
export const WEEK_CHART_CAPTION = "Bars show what you logged. Lines show each day's target.";
export const WEEK_CHART_SPOKEN_TITLE = 'Logged puffs and daily targets this week';
export const CHART_LEGEND = { logged: 'Logged', target: 'Daily target', untracked: 'No activity recorded' } as const;

/** Spoken description of one day in the plan chart. The daily target is added by the chart. */
export function spokenPlanDay(day: { status: DayStatus; count: number; confirmedZero: boolean }): string {
  switch (day.status) {
    case 'outsidePlan':
      return `${puffs(day.count)} logged, outside your plan`;
    case 'paused':
      return `plan paused, ${puffs(day.count)} logged`;
    case 'future':
      return 'not yet';
    case 'today':
      return `today so far, ${puffs(day.count)} logged`;
    case 'untracked':
      return UNTRACKED_DAY_LABEL.toLowerCase();
    case 'withinTarget':
      return day.confirmedZero ? 'confirmed no puffs, within target' : `${puffs(day.count)} logged, within target`;
    case 'aboveTarget':
      return `${puffs(day.count)} logged, above target`;
  }
}

export const averagesLine = (summary: WeekSummary): string | null =>
  summary.averageLogged === null || summary.averageTarget === null
    ? null
    : `On tracked days: ${decimal(summary.averageLogged)} logged on average, with an average target of ${decimal(summary.averageTarget)}.`;

export const MILESTONES_TITLE = 'Milestones';
export const MILESTONES_EMPTY = 'Milestones appear here as you go. Days are counted in total, not in a row, and milestones are never taken away.';
export const NEW_MILESTONE_BADGE = 'New';
export const reachedOnLine = (date: string): string => `Reached ${date}`;

export const PLAN_DETAILS_TITLE = 'Your plan';

export const MANAGE_TITLE = 'Manage your plan';
export const MANAGE_ACTIONS = {
  pace: { label: 'Change pace', detail: 'Ease down faster or more gently from today' },
  revise: { label: 'Revise target', detail: 'Set a new daily target or settle level from today' },
  pause: { label: 'Pause plan', detail: 'Targets are set aside and the schedule waits' },
  resume: { label: 'Resume plan', detail: 'The schedule continues where it stopped' },
  restart: { label: 'Restart plan', detail: 'Start again from your starting level today' },
  end: { label: 'End plan', detail: 'Go back to tracking only' },
} as const;
export const REVISE_NOTE = 'Changes apply from today. Past days keep the targets they had.';
export const DAILY_TARGET_FROM_TODAY = 'Daily target from today';
export const SAVE_CHANGES_LABEL = 'Save changes';
export const fromTodayLine = (target: number): string => `From today: ${target} a day`;
export const upcomingChangeLine = (date: string, target: number): string => `From ${date}: ${target} a day`;
export const NO_FURTHER_CHANGES = 'The target stays at this level from here.';
export const PACE_SETTLED_NOTE = 'Your daily target is already at your settle level, so a new pace would not change it. To go lower, revise your target or settle level.';
export const PAUSED_PREVIEW_NOTE = 'While your plan is paused, these dates move later by the days it stays paused.';
export const CURRENT_TARGET_LABEL = 'Current daily target';

export const PAUSED_NOTICE = 'Your plan is paused. Targets are set aside until you resume.';
export const RESUMED_NOTICE = 'Your plan has resumed.';
export const REVISED_NOTICE = `Your plan has been updated. ${KEPT_ON_CHANGE}`;
export const RESTARTED_NOTICE = `Your plan has restarted. ${KEPT_ON_CHANGE}`;
export const ENDED_NOTICE = `Your plan has ended. ${KEPT_ON_CHANGE}`;
export const RESTART_TITLE = 'Restart your plan?';
export const RESTART_CONFIRM = 'Restart';
export const END_TITLE = 'End your plan?';
export const END_CONFIRM = 'End plan';

export const PLAN_STATUS_LABEL = { track: 'Tracking only', reduce: 'Cutting down', quit: 'Toward quitting', paused: 'Paused' } as const;
export const YOUR_PLAN_ROW = 'Your Plan';
export const PLAN_SECTION_TITLE = 'Plan';
export const YOUR_PLAN_CAPTION = 'A daily target at your own pace, or just tracking.';

/** "Clear puff history" confirmation: what is deleted, what stays, and what that means for the plan. */
export const clearHistoryMessage = (logCount: number): string =>
  `${logCount === 1 ? 'Your 1 logged puff' : `All ${logCount} logged puffs`} will be permanently deleted from this device. ` +
  'Your plan settings stay, but its milestones and the days you confirmed as puff-free are cleared, and a starting level calculated from your history can no longer be checked against your logs. ' +
  'Settings, skips, savings calculator details and Bubble Break scores stay as they are.';

export const RESET_EVERYTHING_MESSAGE =
  'All puff logs and skips, your plan and its milestones, savings calculator details and Bubble Break scores are deleted. Settings return to their defaults, reminders are turned off and Puphii goes back to tracking only. ' +
  'Puphii keeps only the date it was first opened on this device and its data format version, neither of which includes puff data.';

/** Home's one-line summary: what was logged, next to the target. Never a "remaining" amount. */
export function homeTargetLine(progress: TodayProgress): string | null {
  if (progress.kind === 'noPlan') return null;
  if (progress.kind === 'paused') return `${progress.count} logged · Plan paused`;
  return `${progress.count} logged · Daily target ${progress.target}`;
}

/** Home's target card badge: how far today's count is from the target, never an amount to use up. */
export function targetMarginLabel(count: number, target: number): string {
  if (count === target) return 'At target';
  return count < target ? `${target - count} below target` : `${count - target} above target`;
}

export const TARGET_PAUSED_BADGE = 'Plan paused';

export const puffUnit = (count: number): string => (count === 1 ? 'puff' : 'puffs');

export const homeWeekLine = (week: number, goal: 'reduce' | 'quit', paused: boolean): string =>
  paused ? planWeekLine(week, true) : `Week ${week} of your ${goal === 'quit' ? 'quit' : 'reduction'} plan`;

/** The target card's count, target and badge as one spoken sentence. */
export const targetCardSpoken = (count: number, target: number | null, badge: string): string =>
  `${target === null ? puffs(count) : `${count} of ${target} ${puffUnit(target)}`} logged today. ${badge}.`;

export function todayNote(progress: TodayProgress): string | null {
  if (progress.kind === 'noPlan') return null;
  if (progress.kind === 'paused') return 'Your plan is paused. Logging works as usual.';
  switch (progress.state) {
    case 'aboveTarget':
      return `${puffs(progress.above)} above today's target. Logging every puff is what makes your plan useful.`;
    case 'confirmedZero':
      return 'You confirmed no puffs today.';
    case 'withinTarget':
    case 'noLogsYet':
      if (progress.atSettleLevel) return progress.goal === 'quit' ? "Today's target is 0." : "Today's target is your settle level.";
      return progress.state === 'withinTarget' ? "Within today's target." : 'Log puffs as they happen. The target is there for reference.';
  }
}

export const CONFIRM_ZERO_LABEL = 'No puffs today';
export const CONFIRM_ZERO_HINT = 'Marks today as a day with no puffs. Logging a puff later replaces this.';
export const UNTRACKED_DAY_LABEL = 'No activity recorded';
export const PAUSED_DAY_LABEL = 'Plan paused';

export function weekSummaryLine(summary: WeekSummary): string {
  if (summary.finishedDays === 0) return 'Your first finished day will appear here.';
  const tracked = `${summary.withinTargetDays} of ${days(summary.trackedDays)} tracked within target`;
  return summary.untrackedDays ? `${tracked} · ${summary.untrackedDays} with no activity recorded` : tracked;
}

export const MILESTONE_COPY: Record<MilestoneId, { title: string; detail: string }> = {
  firstDayWithinTarget: { title: 'First day within target', detail: 'A finished day at or under its target.' },
  daysWithinTarget3: { title: '3 days within target', detail: 'Counted in total, not in a row.' },
  daysWithinTarget7: { title: '7 days within target', detail: 'Counted in total, not in a row.' },
  daysWithinTarget14: { title: '14 days within target', detail: 'Counted in total, not in a row.' },
  daysWithinTarget30: { title: '30 days within target', detail: 'Counted in total, not in a row.' },
  firstPlanWeek: { title: 'First plan week', detail: 'Seven days with your plan, most of them tracked.' },
  weekBelowBaseline10: { title: 'A week 10% below your start', detail: 'Your average on tracked days that week was at least 10% below your starting level.' },
  weekBelowBaseline25: { title: 'A week 25% below your start', detail: 'Your average on tracked days that week was at least 25% below your starting level.' },
  weekBelowBaseline50: { title: 'A week 50% below your start', detail: 'Your average on tracked days that week was at least 50% below your starting level.' },
  settleLevelReached: { title: 'Reached your settle level', detail: 'A tracked day at or under the level you chose.' },
  firstConfirmedPuffFreeDay: { title: 'A day you confirmed with no puffs', detail: 'Based on your own confirmation.' },
};

export const newMilestoneLine = (id: MilestoneId): string => `New milestone: ${MILESTONE_COPY[id].title}`;

/** Joins parts into one spoken label: one full stop between parts, never two. */
export const spokenSentences = (parts: readonly (string | null | undefined | false)[]): string =>
  parts
    .filter((part): part is string => !!part)
    .map((part) => part.trim().replace(/\.+$/, ''))
    .join('. ');

/** Home's notice for milestones earned since they were last acknowledged. Calm: a title and a fact, no fanfare. */
export const MILESTONE_NOTICE_LABEL = 'New milestone';
export const MILESTONE_NOTICE_DISMISS = 'Dismiss new milestone notice';
export const MILESTONE_NOTICE_HINT = 'Opens Your Plan, where all your milestones are kept';
export function milestoneNotice(ids: readonly MilestoneId[]): { label: string; title: string; detail: string; spoken: string } {
  const titles = ids.map((id) => MILESTONE_COPY[id].title);
  if (ids.length === 1) {
    const { title, detail } = MILESTONE_COPY[ids[0]];
    return { label: MILESTONE_NOTICE_LABEL, title, detail, spoken: `${newMilestoneLine(ids[0])}. ${detail}` };
  }
  const label = `${ids.length} new milestones`;
  return { label, title: titles.join(' · '), detail: 'All your milestones are kept in Your Plan.', spoken: `${label}: ${titles.join(', ')}.` };
}

export const END_PLAN_MESSAGE = `Puphii goes back to tracking only. ${KEPT_ON_CHANGE}`;
export const RESTART_PLAN_MESSAGE = `Your daily target starts again from your starting level today. ${KEPT_ON_CHANGE}`;
export const HOME_INVITE_LABEL = 'Set a daily goal';
export const HOME_INVITE_TEXT = 'Choose a daily target and a pace that suits you. You can change or stop it anytime.';
export const HOME_INVITE_DISMISS = 'Hide the daily goal suggestion for now';
export const HOME_NEW_GOAL_LABEL = 'Set a new goal';
export const HOME_NEW_GOAL_TEXT = 'Your last plan has ended. Choose a new daily target and pace whenever it suits you.';
export const HOME_NEW_GOAL_DISMISS = 'Hide the new goal suggestion for now';
export const HOME_TARGET_TITLE = "Today's target";
export const OPEN_PLAN_HINT = 'Opens Your Plan';

export const PLAN_ERROR_COPY: Record<PlanError, string> = {
  invalidBaseline: 'Enter a starting level between 1 and 1,000 a day.',
  invalidPace: 'Choose a pace between 1% and 50% a week.',
  invalidSettleLevel: 'Choose a settle level below your starting target.',
  invalidTarget: 'Enter a daily target of 0 or more.',
  planAlreadyActive: 'You already have a plan. You can revise or restart it instead.',
  noActivePlan: "There's no active plan right now.",
  futureDay: "Days that haven't happened yet can't be confirmed.",
  dayHasLogs: 'This day already has logged puffs.',
  notReady: 'Your saved data is still loading. Try again in a moment.',
};

/** Static strings, for the wording checks. */
export const STATIC_PLAN_COPY: readonly string[] = [
  ...Object.values(GOAL_COPY).flatMap((goal) => [goal.label, goal.description]),
  ...Object.values(PACE_LABELS),
  PACE_DISCLAIMER,
  ESTIMATE_HINT,
  CONFIRM_ZERO_LABEL,
  CONFIRM_ZERO_HINT,
  UNTRACKED_DAY_LABEL,
  PAUSED_DAY_LABEL,
  ...Object.values(MILESTONE_COPY).flatMap((milestone) => [milestone.title, milestone.detail]),
  KEPT_ON_CHANGE,
  END_PLAN_MESSAGE,
  RESTART_PLAN_MESSAGE,
  HOME_INVITE_LABEL,
  ...Object.values(PLAN_ERROR_COPY),
  PLAN_TAGLINE,
  ADJUST_ANYTIME,
  PLAN_INTRO,
  TRACK_ONLY_NOTE,
  GOAL_QUESTION,
  BASELINE_TITLE,
  ...Object.values(BASELINE_SOURCE_LABEL),
  USE_HISTORY_LABEL,
  USE_ESTIMATE_LABEL,
  ESTIMATE_LABEL,
  PACE_TITLE,
  CUSTOM_PACE_HINT,
  SETTLE_TITLE,
  SETTLE_HINT,
  PREVIEW_TITLE,
  PREVIEW_CAVEAT,
  START_PLAN_LABEL,
  PLAN_STARTED_NOTICE,
  TODAY_TITLE,
  REMOVE_CONFIRMATION_LABEL,
  WEEK_CHART_TITLE,
  WEEK_CHART_CAPTION,
  WEEK_CHART_SPOKEN_TITLE,
  ...Object.values(CHART_LEGEND),
  MILESTONES_TITLE,
  MILESTONES_EMPTY,
  NEW_MILESTONE_BADGE,
  PLAN_DETAILS_TITLE,
  MANAGE_TITLE,
  ...Object.values(MANAGE_ACTIONS).flatMap((action) => [action.label, action.detail]),
  REVISE_NOTE,
  DAILY_TARGET_FROM_TODAY,
  SAVE_CHANGES_LABEL,
  NO_FURTHER_CHANGES,
  PACE_SETTLED_NOTE,
  PAUSED_PREVIEW_NOTE,
  CURRENT_TARGET_LABEL,
  PAUSED_NOTICE,
  RESUMED_NOTICE,
  REVISED_NOTICE,
  RESTARTED_NOTICE,
  ENDED_NOTICE,
  RESTART_TITLE,
  RESTART_CONFIRM,
  END_TITLE,
  END_CONFIRM,
  ...Object.values(PLAN_STATUS_LABEL),
  YOUR_PLAN_ROW,
  PLAN_SECTION_TITLE,
  YOUR_PLAN_CAPTION,
  RESET_EVERYTHING_MESSAGE,
  HOME_INVITE_TEXT,
  HOME_INVITE_DISMISS,
  HOME_NEW_GOAL_LABEL,
  HOME_NEW_GOAL_TEXT,
  HOME_NEW_GOAL_DISMISS,
  HOME_TARGET_TITLE,
  OPEN_PLAN_HINT,
  TARGET_PAUSED_BADGE,
  MILESTONE_NOTICE_LABEL,
  MILESTONE_NOTICE_DISMISS,
  MILESTONE_NOTICE_HINT,
];
