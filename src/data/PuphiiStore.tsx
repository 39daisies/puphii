import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_GAME_STATS, GameStats, recordRound } from '../game/gameStats';
import { AppState } from './appState';
import { createLog, dayKeyOfLog, latestRecordedLog, localDayKey, removeLogById } from './puffLogic';
import { RESET_KEYS, resetValues } from './reset';
import { defaultSavings, deviceCurrency, SavingsSettings } from './savings';
import { CORRUPT_DATA_MESSAGE, loadPersistedState, removeCorruptBackups, STORAGE_KEYS, writeJson } from './storage';
import { StorageKey } from './storageKeys';
import { DEFAULT_SETTINGS, PuffLog, Settings } from './types';
import { createWriteQueue } from './writeQueue';

type PuphiiStore = {
  ready: boolean;
  /** Lifecycle details for future onboarding and offers. Read-only for now. */
  appState: AppState | null;
  logs: PuffLog[];
  settings: Settings;
  storageError: string | null;
  dismissStorageError: () => void;
  /** Records exactly one puff. Returns null until persisted state has loaded. */
  addPuff: () => PuffLog | null;
  /** Removes the most recently recorded log if it belongs to today. */
  undoLatestToday: () => PuffLog | null;
  deleteLog: (id: string) => void;
  clearLogs: () => void;
  resetAll: () => void;
  updateSettings: (patch: Partial<Settings>) => void;
  savings: SavingsSettings;
  /** Receives the latest calculator settings, so quick successive edits never overwrite each other. */
  updateSavings: (update: (current: SavingsSettings) => SavingsSettings) => void;
  gameStats: GameStats;
  /** Records a finished Bubble Break round and returns the updated record. */
  recordGameRound: (score: number) => GameStats;
};

const StoreContext = createContext<PuphiiStore | null>(null);

const SAVE_ERROR = "Couldn't save to this device. Your latest changes may be lost if the app closes.";
const DELETE_ERROR = "Some older saved data couldn't be deleted. Please try clearing again.";

export function PuphiiProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [logs, setLogs] = useState<PuffLog[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [savings, setSavings] = useState<SavingsSettings>(() => defaultSavings(deviceCurrency()));
  const [gameStats, setGameStats] = useState<GameStats>(DEFAULT_GAME_STATS);
  const [appState, setAppState] = useState<AppState | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);

  // Refs are the synchronous source of truth so rapid taps never read stale state.
  const logsRef = useRef<PuffLog[]>([]);
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
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    loadPersistedState().then((result) => {
      if (!mounted) return;
      logsRef.current = result.logs;
      settingsRef.current = result.settings;
      savingsRef.current = result.savings;
      gameStatsRef.current = result.gameStats;
      setLogs(result.logs);
      setSettings(result.settings);
      setSavings(result.savings);
      setGameStats(result.gameStats);
      setAppState(result.appState);
      setStorageError(result.error);
      canSaveRef.current = result.canSave;
      readyRef.current = true;
      setReady(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const commitLogs = useCallback(
    (next: PuffLog[]) => {
      logsRef.current = next;
      setLogs(next);
      queues.logs.save(next);
    },
    [queues],
  );

  const addPuff = useCallback(() => {
    if (!readyRef.current) return null;
    const log = createLog();
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
    purgeBackups([STORAGE_KEYS.logs]);
  }, [commitLogs, purgeBackups]);

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

  const resetAll = useCallback(() => {
    if (!readyRef.current) return;
    const reset = resetValues(deviceCurrency());
    commitLogs(reset.logs);
    gameStatsRef.current = reset.gameStats;
    setGameStats(gameStatsRef.current);
    queues.game.save(gameStatsRef.current);
    settingsRef.current = reset.settings;
    setSettings(settingsRef.current);
    queues.settings.save(settingsRef.current);
    savingsRef.current = reset.savings;
    setSavings(savingsRef.current);
    queues.savings.save(savingsRef.current);
    purgeBackups([...RESET_KEYS]);
  }, [commitLogs, queues, purgeBackups]);

  const value = useMemo<PuphiiStore>(
    () => ({
      ready,
      appState,
      logs,
      settings,
      storageError,
      dismissStorageError: () => setStorageError(null),
      addPuff,
      undoLatestToday,
      deleteLog,
      clearLogs,
      resetAll,
      updateSettings,
      savings,
      updateSavings,
      gameStats,
      recordGameRound,
    }),
    [
      ready,
      appState,
      logs,
      settings,
      savings,
      gameStats,
      storageError,
      addPuff,
      undoLatestToday,
      deleteLog,
      clearLogs,
      resetAll,
      updateSettings,
      updateSavings,
      recordGameRound,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function usePuphii(): PuphiiStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('usePuphii must be used inside <PuphiiProvider>');
  return store;
}
