import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";
import {
  PAGE_PARAM,
  usePagedSearchParams,
  type PagedSearchParams,
} from "./usePagedSearchParams";

// The run listings' filter state, held in the URL alongside the page and the
// free-text query (see {@link usePagedSearchParams}).
//
// The free-text `q` alone can only ever be ONE substring OR'd across the recorded
// identity columns, so it cannot express "this case AND this model", and it cannot
// address a test-case version at all. These facets are the equality filters the
// backend already applies server-side, surfaced as their own params so they AND
// with each other and with `q` — and so a narrowed listing is a linkable URL.

/** The equality facets a run listing can be narrowed by. Each value is a recorded
 * identity (a slug, a version, or a raw model id), never a display name — the
 * backend filters the lifted columns, which hold the raw values. `""` means unset. */
export interface RunFacetValues {
  /** A test-case slug. */
  testCase: string;
  /** An exact test-case version (`v1.2.0`). Only meaningful within a case, so the
   * control offering it is scoped to the selected (or route-fixed) case. */
  version: string;
  /** A harness slug. */
  harness: string;
  /** A run-record model id. */
  model: string;
}

export type RunFacetName = keyof RunFacetValues;

/** The facet names, in the order the filter bar lays their controls out. */
export const RUN_FACETS: readonly RunFacetName[] = [
  "testCase",
  "version",
  "harness",
  "model",
];

/** The URL key each facet rides in. `case` rather than `testCase` to keep a shared
 * link short and readable; the rest match their name on the wire. */
const FACET_PARAMS: Record<RunFacetName, string> = {
  testCase: "case",
  version: "version",
  harness: "harness",
  model: "model",
};

/** The current-version toggle's key. It defaults **on**, so the param appears only
 * to turn it off (`latest=0`) and the common URL stays clean. */
const LATEST_PARAM = "latest";
const LATEST_OFF = "0";

/** The free-text key, mirrored from {@link usePagedSearchParams} so `clear` can
 * drop it in the same write as the facets (two writes would race). */
const QUERY_PARAM = "q";

/** The facets a route pins, which therefore cannot be set or cleared here. */
export interface FixedFacets {
  testCase?: string;
  model?: string;
}

export interface RunFilterState extends PagedSearchParams {
  /** The facet values, `""` where unset. A route-fixed facet reads as its fixed
   * value, so a page can build its query from this alone. */
  facets: RunFacetValues;
  /** Set (or clear, with `""`) one facet. Changing the test case clears the
   * version with it — a version of a different case would filter every run away. */
  setFacet: (name: RunFacetName, value: string) => void;
  /**
   * Whether to restrict each case's runs to its current `major.minor`. **On by
   * default**: a case version is frozen once it has runs, so an older minor is a
   * different spec whose runs are not comparable with the current one's, and a
   * listing that mixes them quietly compares models against different specs.
   */
  latestVersions: boolean;
  setLatestVersions: (on: boolean) => void;
  /** How many filters are narrowing the listing right now (the free text counts as
   * one, and so does the version toggle when it has been turned *off*). Drives the
   * "clear" affordance and tells an over-filtered listing apart from an empty one. */
  activeCount: number;
  /** Reset every settable filter — the text, the facets, and the version toggle —
   * to its default, and return to the first page. Route-fixed facets stay. */
  clear: () => void;
}

/**
 * Keep a run listing's filters in the URL: the page and free text of
 * {@link usePagedSearchParams}, plus the equality facets and the current-version
 * toggle. Every change drops the page param, since a reshaped result set has no
 * business staying on page 7.
 *
 * `fixed` names the facets the *route* already pins (the case-detail Runs tab is
 * one case; a model's Runs tab is one model). Those read as their fixed value and
 * cannot be set, so a page never has to special-case them when it builds its
 * query, and `clear` leaves them alone.
 */
export function useRunFilters(fixed: FixedFacets = {}): RunFilterState {
  const { testCase: fixedCase, model: fixedModel } = fixed;
  const paged = usePagedSearchParams();
  const { setQuery, committedQuery } = paged;
  const [params, setParams] = useSearchParams();

  const facets = useMemo<RunFacetValues>(
    () => ({
      testCase: fixedCase ?? params.get(FACET_PARAMS.testCase) ?? "",
      version: params.get(FACET_PARAMS.version) ?? "",
      harness: params.get(FACET_PARAMS.harness) ?? "",
      model: fixedModel ?? params.get(FACET_PARAMS.model) ?? "",
    }),
    [params, fixedCase, fixedModel],
  );

  const latestVersions = params.get(LATEST_PARAM) !== LATEST_OFF;

  const setFacet = useCallback(
    (name: RunFacetName, value: string) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        setParam(next, FACET_PARAMS[name], value);
        // A version belongs to a case: carrying one across a case change would
        // filter every remaining run away.
        if (name === "testCase") next.delete(FACET_PARAMS.version);
        next.delete(PAGE_PARAM);
        return next;
      });
    },
    [setParams],
  );

  const setLatestVersions = useCallback(
    (on: boolean) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        setParam(next, LATEST_PARAM, on ? "" : LATEST_OFF);
        next.delete(PAGE_PARAM);
        return next;
      });
    },
    [setParams],
  );

  const clear = useCallback(() => {
    // Clear the input's immediate value too, not just the URL: the debounced
    // writer would otherwise push the still-typed text straight back.
    setQuery("");
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const key of Object.values(FACET_PARAMS)) next.delete(key);
      next.delete(LATEST_PARAM);
      next.delete(QUERY_PARAM);
      next.delete(PAGE_PARAM);
      return next;
    });
  }, [setQuery, setParams]);

  const activeCount =
    (committedQuery.trim() ? 1 : 0) +
    RUN_FACETS.filter((name) => !isFixed(name, fixed) && facets[name]).length +
    (latestVersions ? 0 : 1);

  return {
    ...paged,
    facets,
    setFacet,
    latestVersions,
    setLatestVersions,
    activeCount,
    clear,
  };
}

/** Whether the route pins this facet (and so the filter bar must not offer it). */
export function isFixed(name: RunFacetName, fixed: FixedFacets): boolean {
  return (
    (name === "testCase" && fixed.testCase !== undefined) ||
    (name === "model" && fixed.model !== undefined)
  );
}

// Write a param, or drop it when the value is empty, so a default-valued filter
// leaves no trace in the URL.
function setParam(params: URLSearchParams, key: string, value: string): void {
  if (value) params.set(key, value);
  else params.delete(key);
}
