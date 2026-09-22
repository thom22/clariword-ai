import { DEFAULT_BACKEND_URL, SCHEMA_VERSION, STORAGE_KEYS } from '@/shared/constants';
import { DEFAULT_SETTINGS } from '@/shared/defaults';
import { localStore, type KeyValueStore } from '@/services/storage-service';
import type { Settings } from '@/types';

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
  {
    from: 1,
    describe: 'point installs that still hold the old localhost default at the hosted service',
    async run(store) {
      const settings = await store.get<Settings>(STORAGE_KEYS.settings);
      if (!settings) return;

      // Before v1.1.0 the shipped default was http://localhost:8787 in demo
      // mode, so every existing install carries a URL that resolves to the
      // reader's own machine. New defaults never overwrite stored settings,
      // so without this an upgraded install stays broken forever.
      //
      // Only a URL the user never chose is rewritten: anything else is left
      // alone, because it was deliberate.
      const stale = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i;
      const next = { ...settings };
      let changed = false;

      if (!settings.backendUrl || stale.test(settings.backendUrl.trim())) {
        next.backendUrl = DEFAULT_BACKEND_URL;
        next.aiMode = 'backend';
        changed = true;
      }

      if (changed) await store.set({ [STORAGE_KEYS.settings]: next });
    },
  },
  {
    from: 2,
    describe: 'bring installs still on the old 1200-character selection limit down to 900',
    async run(store) {
      const settings = await store.get<Settings>(STORAGE_KEYS.settings);
      if (!settings) return;

      // 1200 was the shipped default before v1.2.0 and is slow enough to hurt
      // (~6.7s for a full passage). Only the old default is rewritten: a value
      // the reader picked themselves is left alone.
      if (settings.maxSelectionChars === 1200) {
        await store.set({
          [STORAGE_KEYS.settings]: { ...settings, maxSelectionChars: DEFAULT_SETTINGS.maxSelectionChars },
        });
      }
    },
  },
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
