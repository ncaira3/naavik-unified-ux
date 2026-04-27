/**
 * Local Caching Service
 * Implements a 3-tier caching strategy:
 * 1. Memory cache (fastest, in-process)
 * 2. IndexedDB (persistent, large capacity ~50MB+)
 * 3. localStorage (fallback, ~5MB limit)
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttlMs: number;
}

interface CacheConfig {
  ttlMs?: number; // Time to live in milliseconds (default: 1 hour)
  useIndexedDB?: boolean; // Use IndexedDB for persistence (default: true)
  /** Skip in-memory caching (use IndexedDB/localStorage only). */
  skipMemory?: boolean;
  /**
   * Optional LRU grouping for bounded caches.
   * When provided, keys are tracked under groupNamespace/group and the cache will
   * evict entire groups when more than maxGroups are present.
   *
   * Intended usage: keep the last N site/date combos hot (e.g. max 10 sites).
   */
  groupNamespace?: string;
  group?: string;
  maxGroups?: number;
}

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour
const DB_NAME = 'naavik_cache_db';
const DB_VERSION = 1;
const STORE_NAME = 'api_cache';

// In-memory cache for ultra-fast access
const memoryCache = new Map<string, CacheEntry<any>>();

type GroupState = {
  order: string[]; // oldest → newest
  keysByGroup: Map<string, Set<string>>;
};

const groupStates = new Map<string, GroupState>();

function shouldSkipMemoryRestore(key: string): boolean {
  // Large map payloads can crash the renderer if held in memory.
  // Keep them persistent in IndexedDB but do not pin in the in-process Map.
  return (
    key.startsWith('topology:') ||
    key.startsWith('map-sites:') ||
    key.startsWith('all-sectors:') ||
    key.startsWith('sectors:') ||
    key.startsWith('site-topology:') ||
    key.startsWith('map:sites:')
  );
}

class LocalCacheService {
  private db: IDBDatabase | null = null;
  private dbInitialized = false;
  private dbInitPromise: Promise<void> | null = null;

  async initIndexedDB(): Promise<void> {
    if (this.dbInitialized) return;
    if (this.dbInitPromise) return this.dbInitPromise;

    this.dbInitPromise = new Promise((resolve, _reject) => {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
          console.warn('IndexedDB initialization failed, falling back to localStorage');
          this.dbInitialized = true;
          resolve();
        };

        request.onsuccess = (event: any) => {
          this.db = event.target.result;
          this.dbInitialized = true;
          resolve();
        };

        request.onupgradeneeded = (event: any) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
            store.createIndex('timestamp', 'timestamp', { unique: false });
          }
        };
      } catch (err) {
        console.warn('IndexedDB not available, falling back to localStorage');
        this.dbInitialized = true;
        resolve();
      }
    });

    return this.dbInitPromise;
  }

  /**
   * Get data from cache
   * Checks memory → IndexedDB → localStorage in order
   */
  async get<T>(key: string): Promise<T | null> {
    // Check memory cache first
    const memEntry = memoryCache.get(key);
    if (memEntry && this.isValid(memEntry)) {
      return memEntry.data;
    }
    memoryCache.delete(key);

    // Check IndexedDB
    await this.initIndexedDB();
    if (this.db) {
      try {
        const idbData = await this.getFromIndexedDB<T>(key);
        if (idbData && this.isValid(idbData)) {
          // Restore to memory cache for next access
          if (!shouldSkipMemoryRestore(key)) memoryCache.set(key, idbData);
          return idbData.data;
        }
      } catch (err) {
        console.warn(`IndexedDB get failed for key ${key}:`, err);
      }
    }

    // Check localStorage as fallback
    try {
      const lsData = localStorage.getItem(`cache:${key}`);
      if (lsData) {
        const entry: CacheEntry<T> = JSON.parse(lsData);
        if (this.isValid(entry)) {
          // Restore to memory cache
          if (!shouldSkipMemoryRestore(key)) memoryCache.set(key, entry);
          return entry.data;
        } else {
          localStorage.removeItem(`cache:${key}`);
        }
      }
    } catch (err) {
      console.warn(`localStorage get failed for key ${key}:`, err);
    }

    return null;
  }

  /**
   * Touch a key's group recency for LRU eviction.
   * Call this on cache hits as well as cache sets so "recently used" sites stay hot.
   */
  async touchGroupKey(key: string, config: Pick<CacheConfig, 'groupNamespace' | 'group' | 'maxGroups'>): Promise<void> {
    const namespace = config.groupNamespace;
    const group = config.group;
    const maxGroups = config.maxGroups;
    if (!namespace || !group || !maxGroups || maxGroups <= 0) return;

    const state: GroupState =
      groupStates.get(namespace) ?? { order: [], keysByGroup: new Map<string, Set<string>>() };
    groupStates.set(namespace, state);

    // Track membership for bulk eviction.
    const keySet = state.keysByGroup.get(group) ?? new Set<string>();
    keySet.add(key);
    state.keysByGroup.set(group, keySet);

    // Move group to the end (most recent).
    const idx = state.order.indexOf(group);
    if (idx >= 0) state.order.splice(idx, 1);
    state.order.push(group);

    // Evict oldest groups if needed.
    const overflow = state.order.length - maxGroups;
    if (overflow <= 0) return;

    const evictedGroups = state.order.splice(0, overflow);
    const evictKeys: string[] = [];
    for (const g of evictedGroups) {
      const keys = state.keysByGroup.get(g);
      if (keys) {
        evictKeys.push(...Array.from(keys));
      }
      state.keysByGroup.delete(g);
    }

    if (!evictKeys.length) return;

    // Memory + localStorage eviction.
    for (const k of evictKeys) {
      memoryCache.delete(k);
      try { localStorage.removeItem(`cache:${k}`); } catch { /* ignore */ }
    }

    // Best-effort IndexedDB eviction (only if IDB is available).
    await this.initIndexedDB();
    if (this.db) {
      try {
        await new Promise<void>((resolve) => {
          const tx = this.db!.transaction([STORE_NAME], 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          evictKeys.forEach((k) => store.delete(k));
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        });
      } catch {
        // ignore
      }
    }
  }

  /**
   * Set data in cache
   * Stores in memory immediately, then IndexedDB/localStorage asynchronously
   */
  async set<T>(key: string, data: T, config: CacheConfig = {}): Promise<void> {
    const ttlMs = config.ttlMs ?? DEFAULT_TTL_MS;
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttlMs,
    };

    // Store in memory immediately
    if (!config.skipMemory && !shouldSkipMemoryRestore(key)) {
      memoryCache.set(key, entry);
    } else {
      memoryCache.delete(key);
    }

    // Track group recency/eviction (for bounded caches)
    await this.touchGroupKey(key, config);

    // Store in IndexedDB asynchronously
    await this.initIndexedDB();
    if (this.db && config.useIndexedDB !== false) {
      this.setInIndexedDB(key, entry).catch((err) =>
        console.warn(`IndexedDB set failed for key ${key}:`, err)
      );
    } else {
      // Fall back to localStorage
      try {
        localStorage.setItem(`cache:${key}`, JSON.stringify(entry));
      } catch (err) {
        console.warn(`localStorage set failed for key ${key}:`, err);
      }
    }
  }

  /**
   * Clear specific cache entry
   */
  async delete(key: string): Promise<void> {
    memoryCache.delete(key);
    localStorage.removeItem(`cache:${key}`);

    await this.initIndexedDB();
    if (this.db) {
      return new Promise((resolve) => {
        const tx = this.db!.transaction([STORE_NAME], 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.delete(key);
        tx.oncomplete = () => resolve();
      });
    }
  }

  /**
   * Clear all cache
   */
  async clearAll(): Promise<void> {
    memoryCache.clear();

    // Clear localStorage
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith('cache:')) {
        localStorage.removeItem(key);
      }
    }

    // Clear IndexedDB
    await this.initIndexedDB();
    if (this.db) {
      return new Promise((resolve) => {
        const tx = this.db!.transaction([STORE_NAME], 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.clear();
        tx.oncomplete = () => resolve();
      });
    }
  }

  /**
   * Get cache stats
   */
  getStats(): {
    memoryEntries: number;
    localStorageEntries: number;
  } {
    let lsCount = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('cache:')) lsCount++;
    }

    return {
      memoryEntries: memoryCache.size,
      localStorageEntries: lsCount,
    };
  }

  // Private methods

  private isValid<T>(entry: CacheEntry<T>): boolean {
    const age = Date.now() - entry.timestamp;
    return age < entry.ttlMs;
  }

  private getFromIndexedDB<T>(key: string): Promise<CacheEntry<T> | null> {
    return new Promise((resolve, _reject) => {
      if (!this.db) {
        resolve(null);
        return;
      }

      try {
        const tx = this.db.transaction([STORE_NAME], 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(key);

        request.onsuccess = () => {
          resolve(request.result || null);
        };

        request.onerror = () => {
          console.warn('IndexedDB get error:', request.error);
          resolve(null);
        };
      } catch (err) {
        console.warn('IndexedDB get exception:', err);
        resolve(null);
      }
    });
  }

  private setInIndexedDB<T>(key: string, entry: CacheEntry<T>): Promise<void> {
    return new Promise((resolve, _reject) => {
      if (!this.db) {
        resolve();
        return;
      }

      try {
        const tx = this.db.transaction([STORE_NAME], 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.put({ key, ...entry });

        request.onsuccess = () => {
          resolve();
        };

        request.onerror = () => {
          console.warn('IndexedDB set error:', request.error);
          resolve();
        };
      } catch (err) {
        console.warn('IndexedDB set exception:', err);
        resolve();
      }
    });
  }
}

export const localCache = new LocalCacheService();
