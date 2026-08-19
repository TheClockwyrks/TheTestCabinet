import { useEffect, useState } from "react";
import type { RunSubject } from "@test-cabinet/run-record";
import type { CatalogStatus, ReviewModel } from "./galleryContext";
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
// The cache holds the promise rather than the value so the several detail
// surfaces that mount together for one case (a run's Inputs tab, its errata
// callout, and its review scoring model all key on the same slug) share a single
// in-flight request instead of racing three identical ones. A case version
// directory is frozen once it has runs, so a resolved detail is safe to keep for
// the session.
const CACHE = new WeakMap<
  Resolver,
  Map<string, Promise<TestCaseDetail | null>>
>();

function resolveCached(
  resolver: Resolver,
  slug: string,
): Promise<TestCaseDetail | null> {
  let bySlug = CACHE.get(resolver);
  if (!bySlug) {
    bySlug = new Map();
    CACHE.set(resolver, bySlug);
  }
  const cached = bySlug.get(slug);
  if (cached) return cached;
  // A rejected fetch is evicted so a transient failure can be retried by the next
  // mount, rather than being remembered as a permanent error for the session.
  const pending = resolver(slug).catch((cause: unknown) => {
    bySlug.delete(slug);
    throw cause;
  });
  bySlug.set(slug, pending);
  return pending;
}

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
  const [state, setState] = useState<TestCaseState>({
    testCase: undefined,
    status: slug && readTestCase ? "loading" : "ready",
  });

  useEffect(() => {
    if (!slug) {
      setState({ testCase: undefined, status: "ready" });
      return;
    }
    // A host that cannot resolve a case by slug (none today) has no source to
    // wait on, so this settles immediately rather than waiting forever.
    if (!readTestCase) {
      setState({ testCase: undefined, status: "ready" });
      return;
    }
    let active = true;
    setState({ testCase: undefined, status: "loading" });
    resolveCached(readTestCase, slug)
      .then((testCase) => {
        if (!active) return;
        setState({ testCase: testCase ?? undefined, status: "ready" });
      })
      .catch(() => {
        if (!active) return;
        setState({ testCase: undefined, status: "error" });
      });
    return () => {
      active = false;
    };
  }, [readTestCase, slug]);

  return state;
}

/** A run's scoring model alongside the load state of the case fetch behind it. */
export interface ReviewModelState extends ReviewModel {
  /** The load state of the case this model was resolved from. Items and domains
   * are empty while it is `loading`, so score them only once it is `ready`. */
  status: CatalogStatus;
}

/**
 * The scoring model for a run's subject: the effective (common + variant)
 * weighted checklist items and the effective (common + variant) scoring domains,
 * resolved from the run's case. Lets the verdict page, the review pages, and the
 * review editor score a run from its verdicts and per-domain ratings.
 *
 * Items and domains are empty both while the case is being fetched and when this
 * host holds no such case — the two are not the same thing, so `status` is
 * carried alongside: a surface that hides its score when the model is empty must
 * wait for `ready` before concluding there is no model.
 */
export function useReviewModel(subject: RunSubject): ReviewModelState {
  const { testCase, status } = useTestCase(subject.testCaseSlug);
  const variant = testCase?.variants.find((v) => v.slug === subject.variant);
  return {
    items: variant?.reviewItems ?? [],
    // The variant's effective scoring domains (common + its own). Falls back to
    // the case's common domains when the variant can't be resolved.
    domains: variant?.domains ?? testCase?.domains ?? [],
    status,
  };
}
