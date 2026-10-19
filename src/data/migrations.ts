import { createAppState } from './appState';
import { isRecord } from './preserve';

/**
 * Stored data as parsed JSON, before validation. `null` means the key is absent.
 * Version 1 is everything saved before the schema was versioned; its layout is unchanged.
 */
export type RawData = {
  logs: unknown;
  settings: unknown;
  savings: unknown;
  game: unknown;
  appState: unknown;
  /** Added without a schema change: installs from before plans simply have none. */
  plan: unknown;
  /** Added without a schema change, like plans. */
  pepRallies: unknown;
  /** Added without a schema change, like plans. */
  skips: unknown;
  /** Added without a schema change, like plans. */
  skipMilestones: unknown;
};

export type MigrationContext = { now: Date };

/**
 * Migrations must be pure and idempotent: if the app stops before the new version is
 * recorded, the same migration runs again on its own output.
 */
export type Migration = {
  from: number;
  to: number;
  description: string;
  migrate: (data: RawData, context: MigrationContext) => RawData;
};

export const CURRENT_SCHEMA_VERSION = 2;

export const MIGRATIONS: readonly Migration[] = [
  {
    from: 1,
    to: 2,
    description: 'Adds app lifecycle state to an install that already has data.',
    migrate: (data, { now }) =>
      isRecord(data.appState) ? data : { ...data, appState: createAppState(now, 'existingInstall') },
  },
];

export type SchemaMarker = { version: number; updatedAt: string };

export function readSchemaVersion(raw: unknown): number | null {
  if (!isRecord(raw)) return null;
  const { version } = raw;
  return typeof version === 'number' && Number.isInteger(version) && version >= 1 ? version : null;
}

export type MigrationResult = { data: RawData; version: number; applied: string[] };

/** Runs every migration from `fromVersion` up to `targetVersion`, in order. */
export function runMigrations(
  data: RawData,
  fromVersion: number,
  context: MigrationContext,
  migrations: readonly Migration[] = MIGRATIONS,
  targetVersion = CURRENT_SCHEMA_VERSION,
): MigrationResult {
  let current = data;
  let version = fromVersion;
  const applied: string[] = [];
  while (version < targetVersion) {
    const step = migrations.find((migration) => migration.from === version);
    if (!step || step.to !== version + 1) throw new Error(`No migration from schema version ${version}`);
    current = step.migrate(current, context);
    applied.push(step.description);
    version = step.to;
  }
  return { data: current, version, applied };
}
