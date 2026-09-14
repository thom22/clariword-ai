import { SCHEMA_VERSION, STORAGE_KEYS } from '@/shared/constants';
import { localStore, type KeyValueStore } from '@/services/storage-service';

/**
 * Forward-only storage migrations.
 *
 * Each step takes the store from `from` to `from + 1`. Version 1 is the first
 * shipped schema, so there is nothing to do yet — the runner exists so that the
 * first real schema change is a five-line addition rather than a rewrite.
 */
export interface Migration {
  from: number;
  describe: string;
  run(store: KeyValueStore): Promise<void>;
}

export const MIGRATIONS: Migration[] = [
  // Example of the shape a future migration takes:
  // {
  //   from: 1,
  //   describe: 'move vocabulary from one blob to per-entry keys',
  //   async run(store) { ... },
  // },
];

export async function runMigrations(store: KeyValueStore = localStore): Promise<number> {
  const stored = await store.get<number>(STORAGE_KEYS.schemaVersion);
  let version = typeof stored === 'number' ? stored : SCHEMA_VERSION;

  for (const migration of MIGRATIONS.sort((a, b) => a.from - b.from)) {
    if (migration.from !== version) continue;
    await migration.run(store);
    version = migration.from + 1;
    if (__DEV__) console.info(`[ClariWord] migrated storage → v${version} (${migration.describe})`);
  }

  if (version !== stored) await store.set({ [STORAGE_KEYS.schemaVersion]: version });
  return version;
}
