/**
 * What Home's Today's target card shows, worked out from the Home plan view. Pure, so the count,
 * the bar and the badge can be tested without rendering.
 */

import { homeWeekLine, TARGET_PAUSED_BADGE, targetCardSpoken, targetMarginLabel } from './copy';
import type { HomePlanView } from './view';

export type TargetTone = 'within' | 'above' | 'paused';

export type TargetCardModel = {
  paused: boolean;
  count: number;
  /** No target applies while the plan is paused. */
  target: number | null;
  /** Share of the bar to fill, from 0 to 1; capped at 1 above target. Null when there is no bar. */
  fill: number | null;
  tone: TargetTone;
  badge: string;
  weekLine: string;
  spoken: string;
};

const wholeCount = (value: number): number => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

export function targetCardModel(view: Extract<HomePlanView, { kind: 'plan' }>): TargetCardModel {
  const weekLine = homeWeekLine(view.week, view.goal, view.paused);
  const { progress } = view;
  if (progress.kind === 'paused') {
    const count = wholeCount(progress.count);
    return { paused: true, count, target: null, fill: null, tone: 'paused', badge: TARGET_PAUSED_BADGE, weekLine, spoken: targetCardSpoken(count, null, TARGET_PAUSED_BADGE) };
  }
  const count = wholeCount(progress.count);
  const target = wholeCount(progress.target);
  // A target of 0 has no share to fill: the bar is empty until something is logged, then full.
  const fill = target === 0 ? (count > 0 ? 1 : 0) : Math.min(1, count / target);
  const badge = targetMarginLabel(count, target);
  return {
    paused: false,
    count,
    target,
    fill,
    tone: count > target ? 'above' : 'within',
    badge,
    weekLine,
    spoken: targetCardSpoken(count, target, badge),
  };
}
