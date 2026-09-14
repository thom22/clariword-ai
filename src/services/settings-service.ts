import { SCHEMA_VERSION, STORAGE_KEYS } from '@/shared/constants';
import { coerceSettings, DEFAULT_SETTINGS } from '@/shared/defaults';
import { domainOf } from '@/shared/text';
import { syncStore, type KeyValueStore } from '@/services/storage-service';
import type { Settings } from '@/types';

type Listener = (settings: Settings) => void;

/**
 * Settings are read on every selection, so they are cached in memory and
 * refreshed by a storage listener rather than re-read from disk each time.
 */
export class SettingsService {
  private cache: Settings | null = null;
  private listeners = new Set<Listener>();
  private watching = false;

  constructor(private readonly store: KeyValueStore = syncStore) {}

  async get(): Promise<Settings> {
    if (this.cache) return this.cache;
    const stored = await this.store.get<unknown>(STORAGE_KEYS.settings);
    this.cache = coerceSettings(stored);
    this.cache.schemaVersion = SCHEMA_VERSION;
    return this.cache;
  }

  /** Synchronous peek for hot paths; null until `get()` has run once. */
  peek(): Settings | null {
    return this.cache;
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    const current = await this.get();
    const next = coerceSettings({ ...current, ...patch });
    this.cache = next;
    await this.store.set({ [STORAGE_KEYS.settings]: next });
    this.emit(next);
    return next;
  }

  async reset(): Promise<Settings> {
    this.cache = { ...DEFAULT_SETTINGS };
    await this.store.set({ [STORAGE_KEYS.settings]: this.cache });
    this.emit(this.cache);
    return this.cache;
  }

  /** True when ClariWord should stay silent on this page. */
  async isActiveOn(url: string): Promise<boolean> {
    const settings = await this.get();
    if (!settings.enabled) return false;
    const domain = domainOf(url);
    if (!domain) return false;
    return !settings.disabledDomains.some((d) => domain === d || domain.endsWith(`.${d}`));
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    this.startWatching();
    return () => this.listeners.delete(listener);
  }

  private emit(settings: Settings): void {
    for (const listener of this.listeners) listener(settings);
  }

  private startWatching(): void {
    if (this.watching || typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;
    this.watching = true;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync' || !changes[STORAGE_KEYS.settings]) return;
      this.cache = coerceSettings(changes[STORAGE_KEYS.settings]?.newValue);
      this.emit(this.cache);
    });
  }
}

export const settingsService = new SettingsService();
