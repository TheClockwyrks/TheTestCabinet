import { useEffect, useState } from "react";
import { createResolverAssetCaches, type AssetCache } from "./assetCache";
import type { CatalogStatus } from "./galleryContext";
import { useGalleryData } from "./galleryContext";
import type { TestCaseDetail } from "./testCases";

/** One case's detail alongside the load state of the fetch that resolves it, so
 * a caller can tell "still fetching" apart from "this host has no such case". */
export interface TestCaseState {
  /** The resolved case, or undefined while loading and when unavailable. Always
   * check {@link status} before treating undefined as unavailable. */
  testCase: TestCaseDetail | undefined;
  /** `loading` while the fetch is in flight, `ready` once it resolved (with or
   * without a case), `error` when the host could not be reached at all. */
  status: CatalogStatus;
}

/** The host's per-slug resolver, as the cache keys on it. */
type Resolver = (slug: string) => Promise<TestCaseDetail | null>;

// Fetched details, keyed first by the host's resolver and then by slug. Keying on
// the resolver — which each host rebuilds when its backend changes — means a
// switched backend gets a fresh cache for free, with the stale one collected
// along with the callback it was keyed on.
//
// Like every cache of an immutable asset it holds the promise rather than the value,
// so the several detail surfaces that mount together for one case (its errata
// callout and its review scoring model both key on the same slug) share a single
// in-flight request instead of racing identical ones, and a rejected fetch is
// evicted so a transient failure is retried by the next mount. A case version
// directory is frozen once it has runs, so a resolved detail is safe to keep.
//
// Bounded at 64 cases per host, which is more than a session holds in play and
// costs a parsed document each — the prompts, specs and checklists of one case
// version, not its media.
const CACHES = createResolverAssetCaches<Resolver, TestCaseDetail | null>({
  name: "test case detail",
  maxEntries: 64,
  load: (resolver, slug) => resolver(slug),
});

// A host that cannot resolve a case by slug (none today) still has to be given a
// cache, because a hook cannot skip a hook. This one resolves nothing.
const NO_RESOLVER: Resolver = () => Promise.resolve(null);

/**
 * Resolve one test case in full by slug — the description, variants (prompts,
 * seeded specs, references, checklists), changelog, and errata a *detail* surface
 * needs. The catalog itself carries only listing-level summaries (see
 * {@link TestCaseState} and `useTestCases`), so this is how a detail page gets the
 * rest, fetched for the one case being viewed.
 *
 * Pass `undefined` to resolve nothing (a route whose slug hasn't parsed yet),
 * which reports `ready` with no case.
 */
export function useTestCase(slug: string | undefined): TestCaseState {
  const { readTestCase } = useGalleryData();
  // A host that cannot resolve a case by slug (none today) has no source to wait
  // on, so it resolves nothing and settles immediately rather than waiting forever.
  const cache = CACHES.for(readTestCase ?? NO_RESOLVER);
  const key = slug && readTestCase ? slug : null;

  // Seeded from the cache, and re-seeded during the render that sees a new slug
  // rather than in the effect below. A case already resolved this session renders
  // on the very first frame with no loading state: a detail surface is remounted
  // every time a reader moves between the tabs of one case — each is its own route
  // — and a spinner over text the console is still holding is the flash this
  // seeding exists to remove.
  const [seenKey, setSeenKey] = useState(key);
  const [state, setState] = useState<TestCaseState>(() => seed(cache, key));
  if (key !== seenKey) {
    setSeenKey(key);
    setState(seed(cache, key));
  }

  useEffect(() => {
    if (key === null) {
      setState((prev) =>
        prev.status === "ready" && prev.testCase === undefined
          ? prev
          : { testCase: undefined, status: "ready" },
      );
      return;
    }
    let active = true;
    // Only where nothing is held: on a hit the state is already seeded, and
    // blanking it here would put back the spinner the seeding removed.
    if (cache.peek(key) === undefined) {
      setState((prev) =>
        prev.status === "loading"
          ? prev
          : { testCase: undefined, status: "loading" },
      );
    }
    cache
      .load(key)
      .then((testCase) => {
        if (!active) return;
        setState((prev) =>
          prev.status === "ready" && prev.testCase === (testCase ?? undefined)
            ? prev
            : { testCase: testCase ?? undefined, status: "ready" },
        );
      })
      .catch(() => {
        if (!active) return;
        setState({ testCase: undefined, status: "error" });
      });
    return () => {
      active = false;
    };
  }, [cache, key]);

  return state;
}

/** The state a slug starts in: resolved where the cache already holds the case. */
function seed(
  cache: AssetCache<TestCaseDetail | null>,
  key: string | null,
): TestCaseState {
  if (key === null) return { testCase: undefined, status: "ready" };
  const cached = cache.peek(key);
  if (cached === undefined) return { testCase: undefined, status: "loading" };
  return { testCase: cached ?? undefined, status: "ready" };
}
