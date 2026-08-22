import { useEffect, useState } from "react";
import type { RunSubject } from "@test-cabinet/run-record";
import type {
  CaseVariantRef,
  CatalogStatus,
  ReviewModel,
} from "./galleryContext";
import { useGalleryData } from "./galleryContext";
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
export function useRunVariant(subject: RunSubject): RunVariantState {
  const { fetchCaseVariant } = useGalleryData();
  const { testCaseSlug, testCaseVersion, variant, engineSlug } = subject;
  const [state, setState] = useState<RunVariantState>({
    variant: undefined,
    status: "loading",
  });

  useEffect(() => {
    let active = true;
    setState({ variant: undefined, status: "loading" });
    resolveCached(fetchCaseVariant, {
      slug: testCaseSlug,
      version: testCaseVersion,
      variant,
      engine: engineSlug,
    })
      .then((resolved) => {
        if (!active) return;
        setState({ variant: resolved ?? undefined, status: "ready" });
      })
      .catch(() => {
        if (!active) return;
        setState({ variant: undefined, status: "error" });
      });
    return () => {
      active = false;
    };
  }, [fetchCaseVariant, testCaseSlug, testCaseVersion, variant, engineSlug]);

  return state;
}

/** The host's resolver, as the cache keys on it. */
type Resolver = (ref: CaseVariantRef) => Promise<VariantSummary | null>;

// Resolved variants, keyed first by the host's resolver and then by the full
// reference. Keying on the resolver — which each host rebuilds when its backend
// changes — means a switched backend gets a fresh cache for free.
//
// The cache holds the promise rather than the value so the surfaces that mount
// together for one run share a single in-flight request instead of racing
// identical ones. A case version directory is frozen once it has runs, so a
// resolved variant is safe to keep for the session.
const CACHE = new WeakMap<
  Resolver,
  Map<string, Promise<VariantSummary | null>>
>();

function cacheKey(ref: CaseVariantRef): string {
  return `${ref.slug}@${ref.version}/${ref.variant}/${ref.engine}`;
}

function resolveCached(
  resolver: Resolver,
  ref: CaseVariantRef,
): Promise<VariantSummary | null> {
  let byRef = CACHE.get(resolver);
  if (!byRef) {
    byRef = new Map();
    CACHE.set(resolver, byRef);
  }
  const key = cacheKey(ref);
  const cached = byRef.get(key);
  if (cached) return cached;
  // A rejected fetch is evicted so a transient failure can be retried by the next
  // mount, rather than being remembered as a permanent error for the session.
  const pending = resolver(ref).catch((cause: unknown) => {
    byRef.delete(key);
    throw cause;
  });
  byRef.set(key, pending);
  return pending;
}

/** A run's scoring model alongside the load state of the fetch behind it. */
export interface ReviewModelState extends ReviewModel {
  /** The load state of the resolution this model came from. Items and domains
   * are empty while it is `loading`, so score them only once it is `ready`. */
  status: CatalogStatus;
}

/**
 * The scoring model for a run's subject: the effective (common + variant)
 * weighted checklist items and the effective (common + variant) scoring domains.
 * Lets the verdict page, the review pages, and the review editor score a run from
 * its verdicts and per-domain ratings.
 *
 * It resolves through {@link useRunVariant}, so the model is the one belonging to
 * the run's OWN case version. A checklist is a property of a version: items are
 * added, removed and reworded between them, and scoring a run against a later
 * version's checklist decides its verdict against points it was never graded on.
 *
 * Items and domains are empty both while the fetch is in flight and when this
 * host holds no such version — the two are not the same thing, so `status` is
 * carried alongside. There is deliberately no fall back to another version's
 * domains when this one cannot be resolved: a score computed from the wrong
 * version is worse than a surface that reports it has none.
 */
export function useReviewModel(subject: RunSubject): ReviewModelState {
  const { variant, status } = useRunVariant(subject);
  return {
    items: variant?.reviewItems ?? [],
    domains: variant?.domains ?? [],
    status,
  };
}
