/**
 * Persistence layer.
 *
 * Everything above this file talks to `KeyValueStore`, never to
 * `chrome.storage` directly. That is what makes a later cloud-sync adapter a
 * drop-in: implement the same four methods against your API and swap the
 * instance passed to the repositories.
 */

export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  getMany(keys: string[]): Promise<Record<string, unknown>>;
  set(entries: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
  /** Approximate bytes in use, or null when the backend cannot report it. */
  bytesInUse?(): Promise<number | null>;
}

export class ChromeStore implements KeyValueStore {
  constructor(private readonly area: chrome.storage.StorageArea) {}

  async get<T>(key: string): Promise<T | undefined> {
    const result = await this.area.get(key);
    return result[key] as T | undefined;
  }

  async getMany(keys: string[]): Promise<Record<string, unknown>> {
    if (keys.length === 0) return {};
    return this.area.get(keys);
  }

  async set(entries: Record<string, unknown>): Promise<void> {
    await this.area.set(entries);
  }

  async remove(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.area.remove(keys);
  }

  async bytesInUse(): Promise<number | null> {
    try {
      return await this.area.getBytesInUse(null);
    } catch {
      return null;
    }
  }
}

/** In-memory store used by unit tests and by any page without chrome APIs. */
export class MemoryStore implements KeyValueStore {
  private data = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined;
  }

  async getMany(keys: string[]): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      if (this.data.has(key)) out[key] = this.data.get(key);
    }
    return out;
  }

  async set(entries: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(entries)) {
      // Structured-clone the way chrome.storage would, so tests catch
      // accidental sharing of mutable objects.
      this.data.set(key, JSON.parse(JSON.stringify(value)));
    }
  }

  async remove(keys: string[]): Promise<void> {
    for (const key of keys) this.data.delete(key);
  }

  async bytesInUse(): Promise<number | null> {
    return JSON.stringify([...this.data.entries()]).length;
  }
}

const hasChrome = typeof chrome !== 'undefined' && !!chrome.storage;

export const localStore: KeyValueStore = hasChrome ? new ChromeStore(chrome.storage.local) : new MemoryStore();
/** Settings live in `sync` so they follow the user between their machines. */
export const syncStore: KeyValueStore = hasChrome ? new ChromeStore(chrome.storage.sync) : new MemoryStore();

/**
 * Serialises read-modify-write cycles. All mutations run in the single service
 * worker, so one queue per key is enough to prevent lost updates.
 */
export class WriteQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.tail.then(task, task);
    this.tail = next.catch(() => undefined);
    return next;
  }
}
