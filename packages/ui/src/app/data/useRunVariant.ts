import { useCallback, useEffect, useMemo, useState } from "react";
import { createResolverAssetCaches, type AssetCache } from "./assetCache";
import type { RunSubject } from "@clockwyrks/run-record";
import type {
  CaseVariantRef,
  CatalogStatus,
  ReviewModel,
} from "./galleryContext";
import { useGalleryData } from "./galleryContext";
import { reviewItemsForEngine } from "../../ratings";
import type { VariantSummary } from "./testCases";

/** The resolution of a run's catalog variant, alongside the load state of the
 * fetch that resolved it — so a caller can tell "still fetching" apart from
 * "this host does not have the case". */
export interface RunVariantState {
  /** The resolved variant, or undefined while the fetch is in flight and
   * whenever this host holds no such case version/variant. Always check
   * {@link status} before treating an undefined variant as unavailable. */
  variant: VariantSummary | undefined;
  /** The fetch's load state (see {@link CatalogStatus}). */
  status: CatalogStatus;
}

/** {@link RunVariantState} plus a way to re-run a failed resolution. */
export interface RetryableRunVariantState extends RunVariantState {
  /** Re-run the resolution. Meaningful after `status === "error"`: the failed
   * fetch was evicted from the cache, so this refetches. */
  retry: () => void;
}

// Resolve the inputs a run was actually given, so the run's Inputs tab can render
// the same prompt, specs, and references its harness received. A run record only
// records its subject's identity — not the text — so the variant is resolved from
// the host's catalog.
//
// It is resolved against the run's OWN case version and OWN engine, because both
// change what the run was handed: a case's `prompt.hbs` and its `.hbs` specs are
// templates that branch on the selected engine, and two versions of one case are
// two different deliverables. Resolving against the case's latest version, or
// against the engineless rendering, shows a reviewer text the run never saw.
//
// Re-rendering rather than storing the text is exact because a case version with
// runs recorded against it is frozen, so the templates cannot have moved since.
//
// The load state is returned alongside the variant because the two undefined
// cases are not the same thing: while the fetch is in flight nothing is
// resolvable *yet*, and reporting that as "unavailable" makes a wait read as a
// dead end. Only a settled fetch with no match is genuinely unavailable.
export function useRunVariant(subject: RunSubject): RetryableRunVariantState {
  const { testCaseSlug, testCaseVersion, variant, engineSlug } = subject;
  return useCaseVariant(testCaseSlug, testCaseVersion, variant, engineSlug);
}

/**
 * Resolve one variant of one exact case version rendered for one engine — the
 * general form {@link useRunVariant} passes a run's own recorded coordinates to.
 *
 * A surface that lets a *reader* choose the version and engine (the test-case
 * Inputs tab) needs the same resolution without a run to read them off, so the
 * four coordinates are taken as plain arguments rather than assembled into a
 * `CaseVariantRef` by the caller: a fresh object every render would restart the
 * fetch on every render, and the primitives are what the effect can compare.
 *
 * Shares {@link useRunVariant}'s cache, so a run's Inputs tab and a case's Inputs
 * tab looking at the same version/variant/engine resolve it once.
 */
export function useCaseVariant(
  slug: string,
  version: string,
  variant: string,
  engine: string,
): RetryableRunVariantState {
  const { fetchCaseVariant } = useGalleryData();
  const cache = CACHES.for(fetchCaseVariant);
  // An empty coordinate is a caller whose own inputs are still resolving (the
  // detail layout before its case fetch settles). Nothing is resolvable *yet*,
  // which is exactly the `loading` state — asking the host for a blank coordinate
  // would only cache a miss — so it is keyed as nothing at all.
  const key =
    slug && version && variant && engine
      ? cacheKey({ slug, version, variant, engine })
      : null;

  // Seeded from the cache, and re-seeded during the render that sees a new
  // coordinate rather than in the effect below, so a variant already resolved this
  // session renders on the very first frame. The Inputs tab of a run is its own
  // route: leaving it and coming back remounts this, and a spinner over text the
  // console is still holding is the flash the seeding removes.
  const [seenKey, setSeenKey] = useState(key);
  const [state, setState] = useState<RunVariantState>(() => seed(cache, key));
  if (key !== seenKey) {
    setSeenKey(key);
    setState(seed(cache, key));
  }
  // Bumped by `retry` to re-run the effect. A rejected fetch was evicted from the
  // cache, so the re-run genuinely refetches rather than replaying the failure.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (key === null) return;
    let active = true;
    // Only where nothing is held — on a hit the state is already seeded, and
    // blanking it here would put back the spinner the seeding removed. This is also
    // what puts a retry back into `loading`: the failed entry was evicted, so the
    // peek misses.
    if (cache.peek(key) === undefined) {
      setState((prev) =>
        prev.status === "loading"
          ? prev
          : { variant: undefined, status: "loading" },
      );
    }
    cache
      .load(key, () => fetchCaseVariant({ slug, version, variant, engine }))
      .then((resolved) => {
        if (!active) return;
        setState((prev) =>
          prev.status === "ready" && prev.variant === (resolved ?? undefined)
            ? prev
            : { variant: resolved ?? undefined, status: "ready" },
        );
      })
      .catch(() => {
        if (!active) return;
        setState({ variant: undefined, status: "error" });
      });
    return () => {
      active = false;
    };
  }, [cache, key, fetchCaseVariant, slug, version, variant, engine, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}

/** The state a coordinate starts in: resolved where the cache already holds it. */
function seed(
  cache: AssetCache<VariantSummary | null>,
  key: string | null,
): RunVariantState {
  if (key === null) return { variant: undefined, status: "loading" };
  const cached = cache.peek(key);
  if (cached === undefined) return { variant: undefined, status: "loading" };
  return { variant: cached ?? undefined, status: "ready" };
}

/** The host's resolver, as the cache keys on it. */
type Resolver = (ref: CaseVariantRef) => Promise<VariantSummary | null>;

// Resolved variants, keyed first by the host's resolver and then by the full
// reference. Keying on the resolver — which each host rebuilds when its backend
// changes — means a switched backend gets a fresh cache for free.
//
// Like every cache of an immutable asset it holds the promise rather than the
// value, so the surfaces that mount together for one run share a single in-flight
// request instead of racing identical ones, and a rejected fetch is evicted so a
// transient failure is retried rather than remembered for the session. A case
// version directory is frozen once it has runs, so a resolved variant is safe to
// keep.
//
// Bounded at 128 coordinates per host: one case version fans out across its
// variants and engines, so the entries per case are several, and 128 still covers
// far more cases than a session compares. Each is a rendered prompt and its specs —
// text, not media.
//
// The reference is a composite rather than a bare slug, so the loader is supplied
// per call by the hook that holds the four coordinates.
const CACHES = createResolverAssetCaches<Resolver, VariantSummary | null>({
  name: "case variant",
  maxEntries: 128,
});

function cacheKey(ref: CaseVariantRef): string {
  return `${ref.slug}@${ref.version}/${ref.variant}/${ref.engine}`;
}

/** A run's scoring model alongside the load state of the fetch behind it. */
export interface ReviewModelState extends ReviewModel {
  /** The load state of the resolution this model came from. Items and domains
   * are empty while it is `loading`, so score them only once it is `ready`. */
  status: CatalogStatus;
}

/**
 * The scoring model for a run's subject: the checklist the run actually carries
 * (the effective common + variant items, restricted to the run's engine) and the
 * effective (common + variant) scoring domains. Lets the verdict page, the review
 * pages, and the review editor score a run from its verdicts and per-domain
 * ratings.
 *
 * It resolves through {@link useRunVariant}, so the model is the one belonging to
 * the run's OWN case version. A checklist is a property of a version: items are
 * added, removed and reworded between them, and scoring a run against a later
 * version's checklist decides its verdict against points it was never graded on.
 *
 * It is also the one belonging to the run's OWN engine. A point whose validator
 * names a set of engines is meaningful only under those — the same surface can be
 * the model's own code on one engine and the engine's on another — so a run built
 * on any other engine does not carry that point at all: it is not driven, no
 * verdict is recorded against it, it is not shown, and it adds no weight. That is
 * what `reviewItemsForEngine` drops here, mirroring the backend's
 * `review_items_for_engine`, which the review endpoint validates a submitted
 * checklist against.
 *
 * Items and domains are empty both while the fetch is in flight and when this
 * host holds no such version — the two are not the same thing, so `status` is
 * carried alongside. There is deliberately no fall back to another version's
 * domains when this one cannot be resolved: a score computed from the wrong
 * version is worse than a surface that reports it has none.
 */
export function useReviewModel(subject: RunSubject): ReviewModelState {
  const { variant, status } = useRunVariant(subject);
  const declared = variant?.reviewItems;
  const engine = subject.engineSlug;
  // Memoized because the result is a fresh array: the verdict and review surfaces
  // key effects and memos off this list, and a new identity every render would
  // re-seed them forever.
  const items = useMemo(
    () => (declared ? reviewItemsForEngine(declared, engine) : []),
    [declared, engine],
  );
  return {
    items,
    domains: variant?.domains ?? [],
    validatorRated: variant?.validatorRated ?? false,
    status,
  };
}
