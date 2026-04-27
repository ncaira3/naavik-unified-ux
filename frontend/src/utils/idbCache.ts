/**
 * Lightweight IndexedDB cache utility.
 *
 * Single object-store "entries" with shape:
 *   { key: string; value: unknown; storedAt: number; ttlMs: number }
 *
 * All operations are fire-and-forget safe — errors are caught and logged so
 * the caller never has to worry about IDB availability (private-browsing,
 * storage-quota limits, etc.).
 */

const DB_NAME    = 'naavik_cache';
const DB_VERSION = 1;
const STORE      = 'entries';

interface CacheEntry<T = unknown> {
  key:      string;
  value:    T;
  storedAt: number;
  ttlMs:    number;
}

// ─── DB singleton ─────────────────────────────────────────────────────────────

let _db: IDBDatabase | null = null;

function openDb(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };

    req.onsuccess = (e) => {
      _db = (e.target as IDBOpenDBRequest).result;
      resolve(_db);
    };

    req.onerror = () => reject(req.error);
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Read a cached value. Returns `null` when:
 *  - key is absent
 *  - entry has expired (storedAt + ttlMs < now)
 *  - IDB is unavailable
 */
export async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const db    = await openDb();
    const entry = await new Promise<CacheEntry<T> | undefined>((res, rej) => {
      const tx  = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => res(req.result as CacheEntry<T> | undefined);
      req.onerror   = () => rej(req.error);
    });

    if (!entry) return null;
    if (Date.now() > entry.storedAt + entry.ttlMs) {
      // Expired — evict asynchronously, return null
      idbDelete(key).catch(() => {});
      return null;
    }

    return entry.value;
  } catch (err) {
    console.warn('[idbCache] get failed:', err);
    return null;
  }
}

/**
 * Write a value to the cache with a TTL (default 4 hours).
 * Silently swallowed on any IDB error.
 */
export async function idbSet<T>(
  key:   string,
  value: T,
  ttlMs: number = 4 * 60 * 60 * 1000
): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((res, rej) => {
      const tx  = db.transaction(STORE, 'readwrite');
      const req = tx.objectStore(STORE).put({
        key,
        value,
        storedAt: Date.now(),
        ttlMs,
      } satisfies CacheEntry<T>);
      req.onsuccess = () => res();
      req.onerror   = () => rej(req.error);
    });
  } catch (err) {
    console.warn('[idbCache] set failed:', err);
  }
}

/** Delete a single key. */
export async function idbDelete(key: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((res, rej) => {
      const tx  = db.transaction(STORE, 'readwrite');
      const req = tx.objectStore(STORE).delete(key);
      req.onsuccess = () => res();
      req.onerror   = () => rej(req.error);
    });
  } catch (err) {
    console.warn('[idbCache] delete failed:', err);
  }
}

/**
 * Convenience: cache-aside helper.
 * Returns the cached value if fresh, otherwise calls `fetcher`,
 * stores the result, and returns it.
 */
export async function idbCacheAside<T>(
  key:     string,
  fetcher: () => Promise<T>,
  ttlMs?:  number
): Promise<{ value: T; fromCache: boolean }> {
  const cached = await idbGet<T>(key);
  if (cached !== null) {
    return { value: cached, fromCache: true };
  }

  const fresh = await fetcher();
  idbSet(key, fresh, ttlMs).catch(() => {}); // fire-and-forget
  return { value: fresh, fromCache: false };
}
