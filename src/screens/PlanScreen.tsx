import React, { useEffect, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { Banner } from '../components/Banner';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ScreenHeader } from '../components/ScreenHeader';
import { localDayKey } from '../data/puffLogic';
import { PlanActionResult } from '../data/planController';
import { usePuphii } from '../data/PuphiiStore';
import { useToday } from '../hooks/useToday';
import {
  END_CONFIRM,
  END_PLAN_MESSAGE,
  END_TITLE,
  ENDED_NOTICE,
  MANAGE_ACTIONS,
  PAUSED_NOTICE,
  PLAN_ERROR_COPY,
  PLAN_STARTED_NOTICE,
  RESTART_CONFIRM,
  RESTART_PLAN_MESSAGE,
  RESTART_TITLE,
  RESTARTED_NOTICE,
  RESUMED_NOTICE,
  REVISED_NOTICE,
  YOUR_PLAN_ROW,
} from '../plan/copy';
import { MilestoneId } from '../plan/model';
import { activeSegment, openPause, scheduledTarget } from '../plan/schedule';
import { spacing } from '../theme';
import { ManageAction, PlanDashboard } from './plan/PlanDashboard';
import { PaceEditor, ReviseEditor } from './plan/PlanEditors';
import { PlanSetup } from './plan/PlanSetup';

type Mode = 'main' | 'pace' | 'revise';

/**
 * Your Plan, under the You tab: setup when there is no active plan, otherwise the dashboard.
 * Free for everyone; nothing here checks a subscription.
 */
export function PlanPage({ onBack, onScrollTop }: { onBack: () => void; onScrollTop: () => void }) {
  const { plan, logs, planActions } = usePuphii();
  const today = localDayKey(useToday());
  const [mode, setMode] = useState<Mode>('main');
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'restart' | 'end' | null>(null);
  const [newMilestones, setNewMilestones] = useState<MilestoneId[]>([]);

  const segment = activeSegment(plan);
  const paused = !!openPause(plan);
  const editing = segment && mode !== 'main' ? mode : null;

  useEffect(() => {
    planActions.refresh();
  }, [planActions, today]);

  // Milestones earned since they were last acknowledged keep a "New" badge while this page is open.
  // Showing them here acknowledges them, so Home's notice for them goes away too.
  useEffect(() => {
    const unseen = plan.milestones.filter((milestone) => milestone.seenAt === null).map((milestone) => milestone.id);
    if (!unseen.length) return;
    setNewMilestones((previous) => [...previous, ...unseen.filter((id) => !previous.includes(id))]);
    planActions.markMilestonesSeen(unseen);
  }, [plan.milestones, planActions]);

  useEffect(() => {
    if (!editing) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setMode('main');
      return true;
    });
    return () => subscription.remove();
  }, [editing]);

  const show = (message: string) => {
    setNotice(message);
    onScrollTop();
  };

  const run = (result: PlanActionResult, success: string) => {
    if (result.ok) {
      setMode('main');
      show(success);
    } else {
      show(PLAN_ERROR_COPY[result.error]);
    }
  };

  const manage = (action: ManageAction) => {
    if (action === 'pace' || action === 'revise') {
      setNotice(null);
      setMode(action);
      onScrollTop();
    } else if (action === 'pause') run(planActions.pause(), PAUSED_NOTICE);
    else if (action === 'resume') run(planActions.resume(), RESUMED_NOTICE);
    else setConfirm(action);
  };

  const title = editing ? MANAGE_ACTIONS[editing].label : YOUR_PLAN_ROW;
  const back = editing ? () => setMode('main') : onBack;

  return (
    <>
      <ScreenHeader title={title} onBack={back} />
      {notice && !editing ? (
        <View style={styles.notice}>
          <Banner message={notice} onDismiss={() => setNotice(null)} />
        </View>
      ) : null}

      {!segment ? (
        <PlanSetup
          plan={plan}
          logs={logs}
          today={today}
          newMilestones={newMilestones}
          onStart={(settings) => {
            const result = planActions.start(settings);
            if (result.ok) show(PLAN_STARTED_NOTICE);
            return result;
          }}
        />
      ) : editing ? (
        (() => {
          const props = {
            segment,
            currentTarget: scheduledTarget(segment, plan.pauses, today),
            today,
            paused,
            onSave: (revision: Parameters<typeof planActions.revise>[0]) => run(planActions.revise(revision), REVISED_NOTICE),
          };
          return editing === 'pace' ? <PaceEditor key="pace" {...props} /> : <ReviseEditor key="revise" {...props} />;
        })()
      ) : (
        <PlanDashboard
          plan={plan}
          segment={segment}
          logs={logs}
          today={today}
          paused={paused}
          newMilestones={newMilestones}
          onConfirmZero={(confirmed) => {
            const result = planActions.confirmPuffFreeDay(today, confirmed);
            if (!result.ok) show(PLAN_ERROR_COPY[result.error]);
          }}
          onManage={manage}
        />
      )}

      <ConfirmDialog
        visible={confirm === 'restart'}
        title={RESTART_TITLE}
        message={RESTART_PLAN_MESSAGE}
        confirmLabel={RESTART_CONFIRM}
        confirmTone="primary"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          run(planActions.restart(), RESTARTED_NOTICE);
        }}
      />
      <ConfirmDialog
        visible={confirm === 'end'}
        title={END_TITLE}
        message={END_PLAN_MESSAGE}
        confirmLabel={END_CONFIRM}
        confirmTone="primary"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          run(planActions.end(), ENDED_NOTICE);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  notice: { marginBottom: spacing.md },
});
