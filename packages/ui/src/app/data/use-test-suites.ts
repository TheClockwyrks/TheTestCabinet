import type {
  SuiteOut,
  SuiteVersionResponse,
} from "@clockwyrks/run-record/backend-api";
import { useCallback, useEffect, useMemo, useState } from "react";

import { createResolverAssetCaches, useCachedAsset } from "./assetCache";
import { useOptionalBackend } from "../../client/context";

/** The load state of the suite listing, in the same three states the catalog
 * reports (see `CatalogStatus`): still reading, settled (possibly empty), or the
 * read failed. */
export type SuiteListingStatus = "loading" | "ready" | "error";

export interface TestSuitesState {
  /** The suites the host is served, in the order the backend lists them. Already
   * filtered by the deployment's experimental setting, so nothing is filtered
   * again here. */
  suites: SuiteOut[];
  status: SuiteListingStatus;
  /** The failed read's message, shown as a notice above whatever is held. */
  error: string | null;
  /** Re-read the listing. */
  reload: () => Promise<void>;
}

/**
 * Whether the active transport exposes the [test
 * suite](https://docs.testcabinet.ai/test-suites/overview/) reads at all.
 *
 * This is the one condition the whole Test Suites surface hangs off: the tab is
 * offered, and its route is mounted, exactly where a host can answer it. The
 * static gallery mounts no backend provider at all and a backend predating the
 * endpoints omits the method, so both fall out of this one check rather than a
 * second flag that could disagree with it.
 */
export function useSuiteReads(): boolean {
  return useOptionalBackend()?.client?.listTestSuites !== undefined;
}

/**
 * The suites this host offers, read through the active backend.
 *
 * Resolved with {@link useOptionalBackend} rather than `useBackend`, the shape
 * `useComparisons` uses: a host with no backend provider (the static gallery)
 * reports no suites instead of crashing, which is what lets the tab bar render
 * this hook's condition without the page having to exist first.
 */
export function useTestSuites(): TestSuitesState {
  const backend = useOptionalBackend()?.client ?? null;

  const load = useCallback(async (): Promise<SuiteOut[]> => {
    return backend?.listTestSuites ? backend.listTestSuites() : [];
  }, [backend]);

  // The settled state, stamped with the reader that produced it: a reader that
  // has changed since (a switched backend) reports `loading` over the rows it
  // still holds until its own read settles.
  const [listing, setListing] = useState<Listing>({
    source: null,
    suites: [],
    status: "loading",
    error: null,
  });

  const settle = useCallback(
    async (isActive: () => boolean) => {
      try {
        const list = await load();
        if (isActive()) {
          setListing({
            source: load,
            suites: list,
            status: "ready",
            error: null,
          });
        }
      } catch (error_: unknown) {
        if (!isActive()) return;
        // The held listing is deliberately left alone: a failed re-read is stale
        // data, not an empty cabinet, and the page renders the notice above the
        // rows it already has.
        setListing((held) => ({
          source: load,
          suites: held.suites,
          status: "error",
          error: String(error_),
        }));
      }
    },
    [load],
  );

  useEffect(() => {
    let active = true;
    void settle(() => active);
    return () => {
      active = false;
    };
  }, [settle]);

  const reload = useCallback(() => settle(() => true), [settle]);

  const status = listing.source === load ? listing.status : "loading";
  return { suites: listing.suites, status, error: listing.error, reload };
}

/** {@link useTestSuites}'s held state and the reader it was settled by. */
interface Listing {
  source: (() => Promise<SuiteOut[]>) | null;
  suites: SuiteOut[];
  status: SuiteListingStatus;
  error: string | null;
}

/** One suite version's resolved record alongside the load state of the fetch
 * that resolves it, in the same three states {@link TestSuitesState} reports. */
export interface TestSuiteVersionState {
  /** The resolved version, or undefined while loading and after a failure. */
  suite: SuiteVersionResponse | undefined;
  status: SuiteListingStatus;
  /** The failed read's message, for the load-failure state's detail line. */
  error: string | null;
}

/** The host's suite-version read, as the cache keys on it. */
type SuiteReader = (
  slug: string,
  version: string,
) => Promise<SuiteVersionResponse>;

// Resolved suite versions, keyed first by the host's reader and then by
// `<slug>@<version>`. Keyed on the reader for the reason the case-detail cache
// is: a switched backend gets a fresh cache for free.
//
// A suite version is a frozen unit — its specifications, validators, assets and
// definitions move together, and changing any of them produces a new version —
// so a resolved record is safe to keep. Bounded at 32, which is far more
// versions than a session reads and costs one parsed record each.
const SUITE_CACHES = createResolverAssetCaches<
  { read: SuiteReader },
  SuiteVersionResponse
>({
  name: "test suite version",
  maxEntries: 32,
});

/**
 * Resolve one suite version in full — the record every detail tab renders from.
 *
 * Pass `undefined` for either coordinate (a route whose slug has not parsed yet,
 * or a version the listing has not settled on) to resolve nothing, which reports
 * `loading` rather than claiming the version is missing: whether the coordinate
 * names something is decided from the listing, not from this read.
 */
export function useTestSuiteVersion(
  slug: string | undefined,
  version: string | undefined,
): TestSuiteVersionState {
  const backend = useOptionalBackend()?.client ?? null;
  const serves = backend?.getTestSuite !== undefined;
  // The cache is keyed on an object minted per reader, memoized so a re-render
  // does not mint a second cache for the same host.
  const reader = useMemo(
    () => ({
      read: (s: string, v: string): Promise<SuiteVersionResponse> =>
        backend?.getTestSuite
          ? backend.getTestSuite(s, v)
          : Promise.reject(new Error("this host does not serve test suites")),
    }),
    [backend],
  );
  const cache = SUITE_CACHES.for(reader);
  const key = serves && slug && version ? `${slug}@${version}` : null;
  const asset = useCachedAsset(cache, key, (target) => {
    const at = target.lastIndexOf("@");
    return reader.read(target.slice(0, at), target.slice(at + 1));
  });

  // A key of null is "nothing to read yet" rather than a settled absence, so it
  // reports the wait the layout is already in.
  if (key === null) {
    return { suite: undefined, status: "loading", error: null };
  }
  if (asset.error !== null) {
    return { suite: undefined, status: "error", error: asset.error };
  }
  return asset.loading || asset.data === null
    ? { suite: undefined, status: "loading", error: null }
    : { suite: asset.data, status: "ready", error: null };
}
