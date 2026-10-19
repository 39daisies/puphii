import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_GAME_STATS, GameStats, recordRound } from '../game/gameStats';
import { createOnboardingDraft, OnboardingDraft, sanitizeOnboardingDraft } from '../onboarding/model';
import { PepLibrary } from '../pepRally/model';
import { PlanSettings } from '../plan/actions';
import { PlanEventListener } from '../plan/events';
import { defaultPlan, PlanRecord } from '../plan/model';
import { activeSegment } from '../plan/schedule';
import { AppState } from './appState';
import { createPepRallyController, PepRallyController } from './pepRallyController';
import { createPlanController, PlanActions } from './planController';
import { productMetaFor } from './productMeta';
import { createLog, dayKeyOfLog, latestRecordedLog, localDayKey, removeLogById } from './puffLogic';
import { RESET_KEYS, resetValues } from './reset';
import { ResetOutcome, resetOutcomeOf } from './resetOutcome';
import { defaultSavings, deviceCurrency, SavingsSettings } from './savings';
import { defaultSkipMilestones, SkipMilestoneId, SkipMilestoneState, unseenSkipMilestones } from './skipMilestones';
import { createSkip, latestSkipToday } from './skips';
import { CORRUPT_DATA_MESSAGE, loadPersistedState, removeCorruptBackups, STORAGE_KEYS, writeJson } from './storage';
import { StorageKey } from './storageKeys';
import { DEFAULT_SETTINGS, PuffLog, Settings, SkipLog } from './types';
import { createWriteQueue } from './writeQueue';

type PuphiiStore = {
  ready: boolean;
  /** Lifecycle details including onboarding completion. */
  appState: AppState | null;
  /** First-launch draft; null until storage has loaded. */
  onboardingDraft: OnboardingDraft | null;
  /** Persist onboarding step answers (never writes puff/skip logs). */
  updateOnboardingDraft: (next: OnboardingDraft) => void;
  /** Mark onboarding complete and store the plan to activate after entitlement. */
  finishOnboarding: (pendingPlan: PlanSettings) => void;
  /** Start the pending onboarding plan exactly once after a confirmed subscription. */
  activatePendingPlanOnce: () => void;
  logs: PuffLog[];
  settings: Settings;
  storageError: string | null;
  dismissStorageError: () => void;
  /** Records exactly one puff. Returns null until persisted state has loaded. */
  addPuff: () => PuffLog | null;
  /** Removes the most recently recorded log if it belongs to today. */
  undoLatestToday: () => PuffLog | null;
  /** Urges the person chose not to act on. Kept apart from `logs`, so they never count as puffs or touch the plan. */
  skips: SkipLog[];
  /** Records exactly one skip. Returns null until persisted state has loaded. */
  addSkip: () => SkipLog | null;
  /** Removes the most recently recorded skip if it belongs to today. Never touches puff logs. */
  undoLatestSkipToday: () => SkipLog | null;
  /** Cumulative skip milestones already acknowledged. */
  skipMilestones: SkipMilestoneState;
  /** Skip milestones reached but not yet acknowledged. */
  unseenSkipMilestoneIds: SkipMilestoneId[];
  /** Marks the given skip milestones as seen so they never celebrate again. */
  acknowledgeSkipMilestones: (ids: readonly SkipMilestoneId[]) => void;
  deleteLog: (id: string) => void;
  clearLogs: () => void;
  /** Resolves with what could be confirmed. Never `done` unless every recording is confirmed gone. */
  resetAll: () => Promise<ResetOutcome>;
  updateSettings: (patch: Partial<Settings>) => void;
  savings: SavingsSettings;
  /** Receives the latest calculator settings, so quick successive edits never overwrite each other. */
  updateSavings: (update: (current: SavingsSettings) => SavingsSettings) => void;
  gameStats: GameStats;
  /** Records a finished Bubble Break round and returns the updated record. */
  recordGameRound: (score: number) => GameStats;
  /** The reduction plan, free for everyone. Tracking only until a plan is started. */
  plan: PlanRecord;
  /** Each returns the updated plan, or why the change couldn't be made. */
  planActions: PlanActions;
  /** Optional, for features such as Voice Pep Rallies. Returns a function that unsubscribes. */
  subscribePlanEvents: (listener: PlanEventListener) => () => void;
};

const StoreContext = createContext<PuphiiStore | null>(null);
const PepRallyControllerContext = createContext<PepRallyController | null>(null);

const SAVE_ERROR = "Couldn't save to this device. Your latest changes may be lost if the app closes.";
const DELETE_ERROR = "Some older saved data couldn't be deleted. Please try clearing again.";

export function PuphiiProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [logs, setLogs] = useState<PuffLog[]>([]);
  const [skips, setSkips] = useState<SkipLog[]>([]);
  const [skipMilestones, setSkipMilestones] = useState<SkipMilestoneState>(() => defaultSkipMilestones());
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [savings, setSavings] = useState<SavingsSettings>(() => defaultSavings(deviceCurrency()));
  const [gameStats, setGameStats] = useState<GameStats>(DEFAULT_GAME_STATS);
  const [appState, setAppState] = useState<AppState | null>(null);
  const [onboardingDraft, setOnboardingDraft] = useState<OnboardingDraft | null>(null);
  const [plan, setPlan] = useState<PlanRecord>(defaultPlan);
  const [storageError, setStorageError] = useState<string | null>(null);
  const appStateRef = useRef<AppState | null>(null);
  const onboardingDraftRef = useRef<OnboardingDraft | null>(null);

  // Refs are the synchronous source of truth so rapid taps never read stale state.
  const logsRef = useRef<PuffLog[]>([]);
  const skipsRef = useRef<SkipLog[]>([]);
  const skipMilestonesRef = useRef<SkipMilestoneState>(defaultSkipMilestones());
  const settingsRef = useRef<Settings>(DEFAULT_SETTINGS);
  const savingsRef = useRef<SavingsSettings>(savings);
  const gameStatsRef = useRef<GameStats>(DEFAULT_GAME_STATS);
  const readyRef = useRef(false);
  // Stays false if storage couldn't be read, so saving can't overwrite history that is still on the device.
  const canSaveRef = useRef(false);

  const queues = useMemo(() => {
    const onError = () => setStorageError(SAVE_ERROR);
    const onSuccess = () => setStorageError((current) => (current === SAVE_ERROR ? null : current));
    const queue = <T,>(key: StorageKey) => {
      const write = writeJson<T>(key);
      return createWriteQueue<T>((value) => (canSaveRef.current ? write(value) : Promise.resolve()), onError, onSuccess);
    };
    return {
      logs: queue<PuffLog[]>(STORAGE_KEYS.logs),
      settings: queue<Settings>(STORAGE_KEYS.settings),
      savings: queue<SavingsSettings>(STORAGE_KEYS.savings),
      game: queue<GameStats>(STORAGE_KEYS.game),
      plan: queue<PlanRecord>(STORAGE_KEYS.plan),
      skips: queue<SkipLog[]>(STORAGE_KEYS.skips),
      skipMilestones: queue<SkipMilestoneState>(STORAGE_KEYS.skipMilestones),
      appState: queue<AppState>(STORAGE_KEYS.appState),
      onboarding: queue<OnboardingDraft>(STORAGE_KEYS.onboarding),
    };
  }, []);

  // Owns the latest plan, like the refs above, and saves every change through its queue.
  const planController = useMemo(
    () => createPlanController({ logs: () => logsRef.current, save: (next) => queues.plan.save(next), publish: setPlan }),
    [queues],
  );

  // Pep Rally metadata, kept apart from logs and the plan. PepRallyProvider connects access; no screen uses it yet, and no media store is attached.
  const pepRallyController = useMemo(() => {
    const write = writeJson<PepLibrary>(STORAGE_KEYS.pepRallies);
    return createPepRallyController({
      write: (library) => write(library),
      onSaveError: () => setStorageError(SAVE_ERROR),
      onSaveSuccess: () => setStorageError((current) => (current === SAVE_ERROR ? null : current)),
    });
  }, []);

  useEffect(() => {
    let mounted = true;
    Promise.all([loadPersistedState(), AsyncStorage.getItem(STORAGE_KEYS.onboarding)]).then(([result, onboardingRaw]) => {
      if (!mounted) return;
      logsRef.current = result.logs;
      skipsRef.current = result.skips;
      skipMilestonesRef.current = result.skipMilestones;
      settingsRef.current = result.settings;
      savingsRef.current = result.savings;
      gameStatsRef.current = result.gameStats;
      setLogs(result.logs);
      setSkips(result.skips);
      setSkipMilestones(result.skipMilestones);
      setSettings(result.settings);
      setSavings(result.savings);
      setGameStats(result.gameStats);
      appStateRef.current = result.appState;
      setAppState(result.appState);
      let draft: OnboardingDraft = createOnboardingDraft();
      if (onboardingRaw) {
        try {
          draft = sanitizeOnboardingDraft(JSON.parse(onboardingRaw)) ?? createOnboardingDraft();
        } catch {
          draft = createOnboardingDraft();
        }
      }
      onboardingDraftRef.current = draft;
      setOnboardingDraft(draft);
      setStorageError(result.error);
      canSaveRef.current = result.canSave;
      planController.load(result.plan);
      pepRallyController.load(result.pepRallies, { canSave: result.canSave });
      readyRef.current = true;
      setReady(true);
    });
    return () => {
      mounted = false;
    };
  }, [planController, pepRallyController]);

  const updateOnboardingDraft = useCallback(
    (next: OnboardingDraft) => {
      if (!readyRef.current) return;
      onboardingDraftRef.current = next;
      setOnboardingDraft(next);
      queues.onboarding.save(next);
    },
    [queues],
  );

  const finishOnboarding = useCallback(
    (pendingPlan: PlanSettings) => {
      if (!readyRef.current) return;
      const now = new Date().toISOString();
      const nextDraft: OnboardingDraft = {
        ...(onboardingDraftRef.current ?? createOnboardingDraft()),
        step: 'preview',
        pendingPlan,
        planActivatedAt: null,
      };
      onboardingDraftRef.current = nextDraft;
      setOnboardingDraft(nextDraft);
      queues.onboarding.save(nextDraft);
      const current = appStateRef.current;
      if (current) {
        const nextApp: AppState = { ...current, onboardingCompletedAt: now };
        appStateRef.current = nextApp;
        setAppState(nextApp);
        queues.appState.save(nextApp);
      }
    },
    [queues],
  );

  const activatePendingPlanOnce = useCallback(() => {
    if (!readyRef.current) return;
    const draft = onboardingDraftRef.current;
    if (!draft?.pendingPlan || draft.planActivatedAt) return;
    if (activeSegment(planController.current())) {
      const cleared: OnboardingDraft = { ...draft, planActivatedAt: new Date().toISOString(), pendingPlan: null };
      onboardingDraftRef.current = cleared;
      setOnboardingDraft(cleared);
      queues.onboarding.save(cleared);
      return;
    }
    const result = planController.actions.start(draft.pendingPlan);
    if (!result.ok && result.error !== 'planAlreadyActive') return;
    const nextDraft: OnboardingDraft = { ...draft, planActivatedAt: new Date().toISOString(), pendingPlan: null };
    onboardingDraftRef.current = nextDraft;
    setOnboardingDraft(nextDraft);
    queues.onboarding.save(nextDraft);
  }, [queues, planController]);

  const commitLogs = useCallback(
    (next: PuffLog[]) => {
      logsRef.current = next;
      setLogs(next);
      queues.logs.save(next);
      planController.logsChanged();
    },
    [queues, planController],
  );

  const addPuff = useCallback(() => {
    if (!readyRef.current) return null;
    const meta = productMetaFor(savingsRef.current.productType);
    const log = createLog(new Date(), meta);
    commitLogs([...logsRef.current, log]);
    return log;
  }, [commitLogs]);

  const undoLatestToday = useCallback(() => {
    if (!readyRef.current) return null;
    const latest = latestRecordedLog(logsRef.current);
    if (!latest || dayKeyOfLog(latest) !== localDayKey(new Date())) return null;
    commitLogs(logsRef.current.slice(0, -1));
    return latest;
  }, [commitLogs]);

  const deleteLog = useCallback(
    (id: string) => {
      if (!readyRef.current) return;
      commitLogs(removeLogById(logsRef.current, id));
    },
    [commitLogs],
  );

  const commitSkips = useCallback(
    (next: SkipLog[]) => {
      skipsRef.current = next;
      setSkips(next);
      queues.skips.save(next);
    },
    [queues],
  );

  const addSkip = useCallback(() => {
    if (!readyRef.current) return null;
    const skip = createSkip();
    commitSkips([...skipsRef.current, skip]);
    return skip;
  }, [commitSkips]);

  const undoLatestSkipToday = useCallback(() => {
    if (!readyRef.current) return null;
    const latest = latestSkipToday(skipsRef.current, localDayKey(new Date()));
    if (!latest) return null;
    commitSkips(skipsRef.current.slice(0, -1));
    return latest;
  }, [commitSkips]);

  const commitSkipMilestones = useCallback(
    (next: SkipMilestoneState) => {
      skipMilestonesRef.current = next;
      setSkipMilestones(next);
      queues.skipMilestones.save(next);
    },
    [queues],
  );

  const acknowledgeSkipMilestones = useCallback(
    (ids: readonly SkipMilestoneId[]) => {
      if (!readyRef.current || !ids.length) return;
      const seen = new Set(skipMilestonesRef.current.seen);
      ids.forEach((id) => seen.add(id));
      commitSkipMilestones({ seen: [...seen] });
    },
    [commitSkipMilestones],
  );

  const unseenSkipMilestoneIds = useMemo(
    () => unseenSkipMilestones(skips.length, skipMilestones.seen),
    [skips.length, skipMilestones.seen],
  );

  const purgeBackups = useCallback((keys: StorageKey[]) => {
    if (!canSaveRef.current) return;
    removeCorruptBackups(keys).then(
      () => setStorageError((current) => (current === CORRUPT_DATA_MESSAGE ? null : current)),
      () => setStorageError(DELETE_ERROR),
    );
  }, []);

  const clearLogs = useCallback(() => {
    if (!readyRef.current) return;
    commitLogs([]);
    planController.clearHistory();
    purgeBackups([STORAGE_KEYS.logs]);
  }, [commitLogs, planController, purgeBackups]);

  const updateSettings = useCallback(
    (patch: Partial<Settings>) => {
      if (!readyRef.current) return;
      const next = { ...settingsRef.current, ...patch };
      settingsRef.current = next;
      setSettings(next);
      queues.settings.save(next);
    },
    [queues],
  );

  const updateSavings = useCallback(
    (update: (current: SavingsSettings) => SavingsSettings) => {
      if (!readyRef.current) return;
      const next = update(savingsRef.current);
      savingsRef.current = next;
      setSavings(next);
      queues.savings.save(next);
    },
    [queues],
  );

  const recordGameRound = useCallback(
    (score: number) => {
      const next = recordRound(gameStatsRef.current, score);
      // Before loading finishes there is nothing safe to merge with, so the round isn't saved.
      if (!readyRef.current) return next;
      gameStatsRef.current = next;
      setGameStats(next);
      queues.game.save(next);
      return next;
    },
    [queues],
  );

  const resetAll = useCallback(async (): Promise<ResetOutcome> => {
    if (!readyRef.current) return 'notFinished';
    const reset = resetValues(deviceCurrency());
    commitLogs(reset.logs);
    commitSkips(reset.skips);
    commitSkipMilestones(reset.skipMilestones);
    gameStatsRef.current = reset.gameStats;
    setGameStats(gameStatsRef.current);
    queues.game.save(gameStatsRef.current);
    settingsRef.current = reset.settings;
    setSettings(settingsRef.current);
    queues.settings.save(settingsRef.current);
    savingsRef.current = reset.savings;
    setSavings(savingsRef.current);
    queues.savings.save(savingsRef.current);
    const recordings = pepRallyController.reset();
    planController.reset();
    purgeBackups([...RESET_KEYS]);
    return resetOutcomeOf(await recordings.catch(() => null));
  }, [commitLogs, commitSkips, commitSkipMilestones, queues, planController, pepRallyController, purgeBackups]);

  const value = useMemo<PuphiiStore>(
    () => ({
      ready,
      appState,
      onboardingDraft,
      updateOnboardingDraft,
      finishOnboarding,
      activatePendingPlanOnce,
      logs,
      settings,
      storageError,
      dismissStorageError: () => setStorageError(null),
      addPuff,
      undoLatestToday,
      skips,
      addSkip,
      undoLatestSkipToday,
      skipMilestones,
      unseenSkipMilestoneIds,
      acknowledgeSkipMilestones,
      deleteLog,
      clearLogs,
      resetAll,
      updateSettings,
      savings,
      updateSavings,
      gameStats,
      recordGameRound,
      plan,
      planActions: planController.actions,
      subscribePlanEvents: planController.subscribe,
    }),
    [
      ready,
      appState,
      onboardingDraft,
      updateOnboardingDraft,
      finishOnboarding,
      activatePendingPlanOnce,
      logs,
      settings,
      savings,
      gameStats,
      plan,
      planController,
      storageError,
      addPuff,
      undoLatestToday,
      skips,
      addSkip,
      undoLatestSkipToday,
      skipMilestones,
      unseenSkipMilestoneIds,
      acknowledgeSkipMilestones,
      deleteLog,
      clearLogs,
      resetAll,
      updateSettings,
      updateSavings,
      recordGameRound,
    ],
  );

  return (
    <StoreContext.Provider value={value}>
      <PepRallyControllerContext.Provider value={pepRallyController}>{children}</PepRallyControllerContext.Provider>
    </StoreContext.Provider>
  );
}

/** The controller this store loads and resets. Only PepRallyProvider reads it; screens use that provider. */
export function useStorePepRallyController(): PepRallyController {
  const controller = useContext(PepRallyControllerContext);
  if (!controller) throw new Error('useStorePepRallyController must be used inside <PuphiiProvider>');
  return controller;
}

export function usePuphii(): PuphiiStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('usePuphii must be used inside <PuphiiProvider>');
  return store;
}
