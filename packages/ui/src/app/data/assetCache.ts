// The one cache every immutable produced asset is read through.
//
// A run's artifacts — its replay recordings, the pixel buffers beside them, its
// `.glb` parts, its `system.json`, its engine module, its workspace files — do not
// change once the run has produced them. A reviewer, though, moves through them
// constantly: every tab of a run's detail page is its own route, so switching tabs
// unmounts the tab body whole, and without a cache that survives the unmount, going
// to a run's images and back re-downloads and re-decodes a recording the reviewer
// was already looking at. On a slow link that is a spinner in place of a picture
// that had already arrived.
//
// So an asset is resolved by URL through a process-wide cache (see "Immutable asset
// caching" in the UI component doc), and the two properties that make it worth
// having are both here:
//
//   * the cache holds the PROMISE, not the value, so the several surfaces that
//     mount together for one asset share a single in-flight request instead of
//     racing identical ones — and so a mount that arrives while a fetch is in
//     flight waits on that fetch rather than starting a second;
//   * `peek` reads what is already resolved SYNCHRONOUSLY, so a hook can seed its
//     first state from the cache and render the asset on the very first frame.
//     A cache hit that still flashed a spinner would be the bug this exists to fix.
//
// A rejected fetch is evicted, so a transient failure is retried by the next mount
// rather than remembered as a permanent error for the session.

import { useCallback, useEffect, useRef, useState } from "react";

/** One asset's fetch: in flight, or settled with the value it resolved to. */
interface Entry<T> {
  /** The fetch itself. Shared by every caller that asks for this key. */
  readonly promise: Promise<T>;
  /** The resolved value, once it has arrived — what {@link AssetCache.peek} reads. */
  value?: T;
  /** Whether {@link value} is meaningful; a value may legitimately be `undefined`. */
  settled: boolean;
  /** What `weigh` said this value costs, in bytes. Zero while in flight. */
  bytes: number;
}

/** A bounded, process-wide, URL-keyed cache of one kind of immutable asset. */
export interface AssetCache<T> {
  /** What this cache holds, for the doc comment at its declaration and for tests. */
  readonly name: string;
  /**
   * Resolve `key`, through the cache.
   *
   * A hit returns the stored promise (settled or not) and marks the entry as the
   * most recently used. A miss starts `loader` — or the cache's own default loader
   * — and stores the promise before awaiting it, so a second caller arriving in the
   * same tick joins the first fetch.
   *
   * `loader` is per call because some assets are resolved by a function the caller
   * holds rather than one the cache can name (a replay's stored images are reached
   * through the resolver belonging to the recording's namespace). Where every
   * caller resolves a key the same way, give the cache a default loader and omit it.
   */
  load(key: string, loader?: (key: string) => Promise<T>): Promise<T>;
  /**
   * What is already resolved for `key`, or `undefined`.
   *
   * Pure and synchronous, so it is safe to call while rendering: it is how a hook
   * seeds its initial state and renders a cached asset with no loading state. It
   * deliberately does NOT count as a use — reordering the cache during a render
   * would make rendering a side effect — so a caller that wants the entry kept
   * fresh calls {@link load} too, which on a hit is just a bump and a settled
   * promise.
   */
  peek(key: string): T | undefined;
  /**
   * Record a value the cache did not fetch.
   *
   * For an asset the platform loaded on the app's behalf — a picture an `<img>`
   * element fetched and decoded — where what is worth remembering is that the URL
   * has already been through the browser once.
   */
  put(key: string, value: T): void;
  /** How many entries are held, in flight and settled alike. */
  readonly size: number;
  /** What the settled entries weigh in total, in bytes. */
  readonly bytes: number;
  /** Drop everything. For tests; nothing in the app invalidates an immutable asset. */
  clear(): void;
}

/** How a cache is built. See {@link createAssetCache}. */
export interface AssetCacheOptions<T> {
  /** What this cache holds. Names the cache in its own errors and in tests. */
  name: string;
  /**
   * The most entries to hold. Reached first by the caches whose values cannot be
   * weighed portably, and the backstop for the ones that can.
   */
  maxEntries: number;
  /**
   * The most the settled entries may weigh in total, in bytes. Omit where the
   * values have no meaningful size (a parsed document, a marker) and let
   * {@link maxEntries} be the whole bound.
   */
  maxBytes?: number;
  /**
   * What one value costs, in bytes. Only the parts that are actually big need to be
   * counted — an estimate that tracks the value's order of magnitude is what the
   * byte budget is for.
   */
  weigh?: (value: T) => number;
  /** How a key is resolved, where every caller resolves it the same way. */
  load?: (key: string) => Promise<T>;
}

/**
 * Build a bounded URL-keyed cache of immutable assets.
 *
 * **On the bound.** Nothing here is ever invalidated — an artifact does not change
 * once produced — so without a bound a console left open all day would hold every
 * asset every run it visited ever served. A single run tree can reach ~2GB and one
 * recording's decoded bitmaps can reach tens of megabytes, so an unbounded cache is
 * not a cache, it is a leak with a lookup on it. Each cache therefore declares its
 * own bound at its declaration, sized for what a reviewer actually has in play
 * rather than for what they might eventually visit: the point is that leaving a
 * view and coming straight back is free, not that the whole gallery is resident.
 *
 * Eviction is least-recently-used. An in-flight entry is never evicted — a caller
 * is waiting on it and dropping it would only buy a duplicate fetch — and the most
 * recently used entry is never evicted either, so an asset bigger than the whole
 * budget is still served to the view that asked for it.
 */
export function createAssetCache<T>(
  options: AssetCacheOptions<T>,
): AssetCache<T> {
  const { name, maxEntries, maxBytes, weigh, load: defaultLoader } = options;
  const entries = new Map<string, Entry<T>>();
  let totalBytes = 0;

  // Evict least-recently-used entries until the cache is back inside both bounds.
  // Map iteration is insertion order and every use re-inserts, so the head of the
  // iteration is the least recently used.
  function trim(): void {
    for (const [key, entry] of entries) {
      if (entries.size <= 1) break;
      if (
        entries.size <= maxEntries &&
        (maxBytes === undefined || totalBytes <= maxBytes)
      ) {
        break;
      }
      // A fetch that has not landed has a caller awaiting it; evicting it would
      // drop nothing (it weighs nothing yet) and cost that caller nothing, but the
      // next mount would start the request over.
      if (!entry.settled) continue;
      entries.delete(key);
      totalBytes -= entry.bytes;
    }
  }

  // Move an entry to the most-recently-used end of the map.
  function touch(key: string, entry: Entry<T>): void {
    entries.delete(key);
    entries.set(key, entry);
  }

  function settle(key: string, entry: Entry<T>, value: T): void {
    // The entry may already have been dropped — by `clear`, or by a `put` that
    // raced this fetch — in which case this fetch's result is no longer the
    // cache's business.
    if (entries.get(key) !== entry) return;
    entry.value = value;
    entry.settled = true;
    entry.bytes = weigh ? weigh(value) : 0;
    totalBytes += entry.bytes;
    // Settling is a use: the view that asked for it is about to draw it, so it goes
    // to the fresh end before anything is trimmed.
    touch(key, entry);
    trim();
  }

  return {
    name,

    load(key, loader) {
      const cached = entries.get(key);
      if (cached) {
        touch(key, cached);
        return cached.promise;
      }
      const resolve = loader ?? defaultLoader;
      if (!resolve) {
        return Promise.reject(
          new Error(`the ${name} cache was given no loader for ${key}`),
        );
      }
      const entry: Entry<T> = {
        promise: resolve(key).then(
          (value) => {
            settle(key, entry, value);
            return value;
          },
          (cause: unknown) => {
            // A failure is not cached: the next mount refetches rather than
            // replaying an error that may have been the network's, not the file's.
            if (entries.get(key) === entry) entries.delete(key);
            throw cause;
          },
        ),
        settled: false,
        bytes: 0,
      };
      entries.set(key, entry);
      return entry.promise;
    },

    peek(key) {
      const entry = entries.get(key);
      return entry?.settled ? entry.value : undefined;
    },

    put(key, value) {
      const existing = entries.get(key);
      if (existing) {
        entries.delete(key);
        if (existing.settled) totalBytes -= existing.bytes;
      }
      const entry: Entry<T> = {
        promise: Promise.resolve(value),
        value,
        settled: true,
        bytes: weigh ? weigh(value) : 0,
      };
      totalBytes += entry.bytes;
      entries.set(key, entry);
      trim();
    },

    get size() {
      return entries.size;
    },

    get bytes() {
      return totalBytes;
    },

    clear() {
      entries.clear();
      totalBytes = 0;
    },
  };
}

/** A cache per resolver. See {@link createResolverAssetCaches}. */
export interface ResolverAssetCaches<R extends object, T> {
  /** The cache belonging to `resolver`, minted on first use. */
  for(resolver: R): AssetCache<T>;
}

/**
 * A family of caches keyed first on the function that resolves the asset, and then
 * by key within it.
 *
 * For the catalog reads, where the asset is immutable only *for a given host*: a
 * case version with runs against it is frozen, so its detail and its variants are
 * safe to keep — but pointing the console at another backend must not serve that
 * backend's cases out of this one's cache. Each host rebuilds its resolver when its
 * backend changes, so keying on the resolver invalidates the cache for free, and
 * the weak reference lets the stale cache be collected along with the closure it
 * was keyed on.
 */
export function createResolverAssetCaches<R extends object, T>(options: {
  name: string;
  maxEntries: number;
  maxBytes?: number;
  weigh?: (value: T) => number;
  /**
   * How the resolver resolves a key, where the key is all the resolver needs.
   * Omit it where the key is a composite the caller assembles — the caller then
   * supplies the loader per {@link AssetCache.load} call.
   */
  load?: (resolver: R, key: string) => Promise<T>;
}): ResolverAssetCaches<R, T> {
  const { load, ...shared } = options;
  const byResolver = new WeakMap<R, AssetCache<T>>();
  return {
    for(resolver) {
      let cache = byResolver.get(resolver);
      if (!cache) {
        cache = createAssetCache<T>({
          ...shared,
          load: load ? (key) => load(resolver, key) : undefined,
        });
        byResolver.set(resolver, cache);
      }
      return cache;
    },
  };
}

/** What a component reading an immutable asset sees. See {@link useCachedAsset}. */
export interface CachedAsset<T> {
  /** The asset, once resolved; null while it is in flight and after a failure. */
  readonly data: T | null;
  /** Whether a fetch is in flight. **False on a cache hit, on the first frame.** */
  readonly loading: boolean;
  /** Why there is no asset, written for a reviewer, else null. */
  readonly error: string | null;
}

const NOTHING: CachedAsset<never> = {
  data: null,
  loading: false,
  error: null,
};

function seed<T>(cache: AssetCache<T>, key: string | null): CachedAsset<T> {
  if (key === null) return NOTHING;
  const cached = cache.peek(key);
  if (cached !== undefined)
    return { data: cached, loading: false, error: null };
  return { data: null, loading: true, error: null };
}

/** A thrown value as a sentence fit to show a reviewer. */
export function assetErrorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Read one immutable asset through `cache`, as `{ data, loading, error }`.
 *
 * **A cache hit never reports `loading`,** including on the frame the component
 * mounts and on the frame `key` changes: the state is seeded from `peek` in the
 * initializer, and re-seeded during the render that sees a new key rather than in
 * an effect afterwards. Seeding in an effect instead would paint one frame of
 * spinner over an asset the session already had, which is the flash this exists to
 * remove.
 *
 * `null` for `key` is "there is nothing on this side" rather than an error, so a
 * pane with no asset to show settles immediately with no data and no failure.
 *
 * `loader` — for a cache whose assets are not all resolved the same way — is read
 * through a ref rather than depended on, because a caller is free to mint a fresh
 * closure on every render and listing one would restart the fetch on each of them.
 * THE KEY ALONE DRIVES THE FETCH, so a caller does not have to memoize its loader.
 */
export function useCachedAsset<T>(
  cache: AssetCache<T>,
  key: string | null,
  loader?: (key: string) => Promise<T>,
): CachedAsset<T> {
  // Written during render because the effect below runs after it, and because a
  // loader that arrives late is still the right one for a fetch not yet started.
  const latestLoader = useRef(loader);
  latestLoader.current = loader;
  const stableLoader = useCallback(
    (target: string) =>
      latestLoader.current
        ? latestLoader.current(target)
        : Promise.reject(
            new Error(
              `the ${cache.name} cache was given no loader for ${target}`,
            ),
          ),
    [cache],
  );
  const [seenKey, setSeenKey] = useState(key);
  const [state, setState] = useState<CachedAsset<T>>(() => seed(cache, key));
  if (key !== seenKey) {
    setSeenKey(key);
    setState(seed(cache, key));
  }

  useEffect(() => {
    if (key === null) return;
    let active = true;
    // Called even on a hit: it is a bump and a settled promise, and it is what
    // keeps an asset the reviewer keeps returning to at the fresh end of the cache.
    cache.load(key, latestLoader.current ? stableLoader : undefined).then(
      (data) => {
        if (!active) return;
        // Bail out where the seeded state already holds this exact value, so a hit
        // costs no render at all.
        setState((prev) =>
          prev.data === data && !prev.loading && prev.error === null
            ? prev
            : { data, loading: false, error: null },
        );
      },
      (cause: unknown) => {
        if (!active) return;
        setState({
          data: null,
          loading: false,
          error: assetErrorMessage(cause),
        });
      },
    );
    return () => {
      active = false;
    };
    // `loader` is read from the ref above rather than listed here — see the doc
    // comment. Only the key identifies an asset, and only a new key is a reason to
    // throw away a loaded one.
  }, [cache, key, stableLoader]);

  return state;
}
