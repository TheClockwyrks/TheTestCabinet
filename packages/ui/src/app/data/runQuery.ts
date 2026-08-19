// A host-agnostic paged summary query. Both galleries expose the same
// `queryRunSummaries(query)` capability (see {@link GalleryDataInput}): the
// console forwards it to the backend's offset endpoint
// (`GET /runs?fields=summary&offset=…`); the static site has no backend, so it
// answers from its in-memory summary index using {@link runSummaryPage} — the
// pure, filter/sort/window logic in this module, matched to the backend's
// semantics so a page behaves identically on either host.

import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import type { RunSort, SortDir } from "../../client/clients";
import { RATINGS } from "../../ratings";
import { totalTokens } from "../format";
import { currentMajorMinor, majorMinorKey } from "./versions";

export type { RunSort, SortDir };

// The parameters of one summary page request. Mirrors the backend's
// `fields=summary` offset path: a lifecycle `state` slice, the equality filters,
// a free-text `q`, the `sort`/`dir`, and the `offset`/`limit` window. Every field
// is optional; the defaults (published, unfiltered, date-descending, offset 0)
// match the backend's.
export interface RunQuery {
  /** The lifecycle slice to draw from (default `published`). `any` is the union of
   * published and unpublished runs — the consoles' listings, where an unpublished
   * (and so unreviewed) run must sort and page alongside the published ones;
   * `publishable` is the narrower publish worklist (unpublished *and* clearing the
   * backend's publish gate). The static site only holds published runs, so `any` is
   * `published` there and every other non-`published` state matches nothing. */
  state?:
    | "published"
    | "any"
    | "review"
    | "failures"
    | "unpublished"
    | "publishable"
    | "unreviewed";
  /** Filter to one test-case slug (an empty string is ignored). */
  testCase?: string;
  /** Filter to one model id (an empty string is ignored). */
  model?: string;
  /** Filter to one harness slug (an empty string is ignored). */
  harness?: string;
  /** Filter to one variant slug (an empty string is ignored). Paired with
   * {@link testCase} — a variant slug is unique only within its case. */
  variant?: string;
  /** Filter to one exact test-case version (an empty string is ignored). A version
   * only means something within a case, so this is normally paired with
   * {@link testCase}; on its own it is a plain equality filter and selects that
   * version of every case. */
  version?: string;
  /** Restrict every run to its case's **current** version — the greatest
   * `major.minor` that case has a run for within this query's {@link state} slice.
   * A case version is frozen once it has runs, so an older minor is a different
   * spec whose runs are not comparable with the current one's; the console
   * listings default this on.
   *
   * Ignored when {@link version} names an exact version: an explicit version is
   * the more specific instruction, and AND'ing the two would silently empty the
   * listing whenever the picked version is not the current one. */
  latestVersions?: boolean;
  /** Case-insensitive substring across testCase/model/harness/variant. */
  q?: string;
  /** The sort column (default `date`). */
  sort?: RunSort;
  /** The sort direction (default `desc`). */
  dir?: SortDir;
  /** The 0-based row offset of the window (default 0). */
  offset?: number;
  /** The window size; when omitted, every matching row from `offset` on. */
  limit?: number;
}

// One page of a summary query: the windowed cards and the `total` count of all
// matching rows (ignoring the window), which sizes a numbered pager.
export interface RunQueryResult {
  summaries: RunSummary[];
  total: number;
}

// The rank of a rating tier, matching the backend's `rating_rank_expr`: `0` best
// (flawless), larger worse, and an unexpected token beyond the worst tier.
function ratingRank(rating: RunSummary["rating"]): number {
  if (rating === null) return RATINGS.length;
  const index = RATINGS.indexOf(rating);
  return index < 0 ? RATINGS.length : index;
}

// String order (byte-ish, like the DB's column comparison), stable ties → 0.
function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Numeric order treating null as smaller than any value (SQLite's default NULL
// ordering, which the token sort inherits — cost/rating instead pin NULLs last
// via their own null-group key below).
function cmpNum(a: number | null, b: number | null): number {
  const av = a ?? Number.NEGATIVE_INFINITY;
  const bv = b ?? Number.NEGATIVE_INFINITY;
  return av < bv ? -1 : av > bv ? 1 : 0;
}

// Does the query's lifecycle slice hold anything at all here? Split from the rest
// of the predicate because the current-version scope below is resolved over the
// slice *before* the other filters narrow it — exactly as the backend resolves it
// from its own `state_slice`.
//
// The static index is entirely published runs, so `any` (the published +
// unpublished union) collapses to `published`; any other slice matches nothing, so
// this is a property of the query alone rather than of a given row.
function sliceIsPublished(query: RunQuery): boolean {
  return !query.state || query.state === "published" || query.state === "any";
}

// Does `summary` match the query's filters? Mirrors the backend's `summary_query`
// predicate: the equality filters (empty strings ignored) and the lowercased
// substring `q` across the searchable identity columns. The state slice is
// {@link sliceIsPublished}; the current-version scope is
// {@link currentVersionScope}.
function matches(summary: RunSummary, query: RunQuery): boolean {
  const { subject } = summary;
  if (query.testCase && subject.testCaseSlug !== query.testCase) return false;
  if (query.model && subject.modelId !== query.model) return false;
  if (query.harness && subject.harnessSlug !== query.harness) return false;
  if (query.variant && subject.variant !== query.variant) return false;
  if (query.version && subject.testCaseVersion !== query.version) return false;
  const q = query.q?.trim().toLowerCase();
  if (q) {
    const haystack = [
      subject.testCaseSlug,
      subject.modelId,
      subject.harnessSlug,
      subject.variant,
    ].map((s) => s.toLowerCase());
    if (!haystack.some((s) => s.includes(q))) return false;
  }
  return true;
}

// The `latestVersions` scope: each case's current `major.minor`, resolved from the
// runs in the state slice (never from the narrowed set, so which cohort is
// "current" does not shift as other filters are applied). Null when the query did
// not ask for it, or when an exact `version` overrides it — see
// {@link RunQuery.latestVersions}. Mirrors the backend's `current_case_versions`.
function currentVersionScope(
  inSlice: readonly RunSummary[],
  query: RunQuery,
): ReadonlyMap<string, string> | null {
  if (!query.latestVersions || query.version) return null;
  const versions = new Map<string, string[]>();
  for (const { subject } of inSlice) {
    const seen = versions.get(subject.testCaseSlug);
    if (seen) seen.push(subject.testCaseVersion);
    else versions.set(subject.testCaseSlug, [subject.testCaseVersion]);
  }
  const scope = new Map<string, string>();
  for (const [slug, all] of versions) {
    const current = currentMajorMinor(all);
    if (current !== null) scope.set(slug, current);
  }
  return scope;
}

// Is a run's version the current `major.minor` of its case? A case the scope has
// never seen cannot happen (the scope is built from the same set), so an unknown
// slug is out of scope rather than silently admitted.
function inVersionScope(
  summary: RunSummary,
  scope: ReadonlyMap<string, string> | null,
): boolean {
  if (!scope) return true;
  const { subject } = summary;
  return (
    scope.get(subject.testCaseSlug) === majorMinorKey(subject.testCaseVersion)
  );
}

// Compare two summaries by the chosen sort key and direction, mirroring
// `apply_summary_sort` + the `id` tiebreak in the backend: the primary key in the
// given direction; cost and rating lead with a null-group key so NULLs sort LAST
// in either direction; and the run id breaks ties (in the same direction) so the
// order is total and deterministic.
function compare(
  a: RunSummary,
  b: RunSummary,
  sort: RunSort,
  dir: SortDir,
): number {
  const order = dir === "asc" ? 1 : -1;
  const primary = primaryCompare(a, b, sort, order);
  if (primary !== 0) return primary;
  return cmpStr(a.id, b.id) * order;
}

function primaryCompare(
  a: RunSummary,
  b: RunSummary,
  sort: RunSort,
  order: number,
): number {
  switch (sort) {
    case "date":
      return cmpStr(a.startedAt, b.startedAt) * order;
    case "runtime":
      return cmpNum(a.metrics.runTimeSeconds, b.metrics.runTimeSeconds) * order;
    case "tokens":
      return cmpNum(totalTokens(a.metrics), totalTokens(b.metrics)) * order;
    case "testType":
      return cmpStr(a.subject.testType, b.subject.testType) * order;
    case "testCase":
      return cmpStr(a.subject.testCaseSlug, b.subject.testCaseSlug) * order;
    case "harness":
      return cmpStr(a.subject.harnessSlug, b.subject.harnessSlug) * order;
    case "model":
      return cmpStr(a.subject.modelId, b.subject.modelId) * order;
    case "variant":
      return cmpStr(a.subject.variant, b.subject.variant) * order;
    case "cost": {
      // Unknown-cost NULLs sort last in either direction: order first by a
      // null-group key (non-null before null), then by the value.
      const group = nullGroup(
        a.metrics.cost.comparable,
        b.metrics.cost.comparable,
      );
      if (group !== 0) return group;
      return (
        cmpNum(a.metrics.cost.comparable, b.metrics.cost.comparable) * order
      );
    }
    case "rating": {
      // Unrated (NULL) runs sort last in either direction; ranked runs by tier.
      const group = nullGroup(a.rating, b.rating);
      if (group !== 0) return group;
      return (ratingRank(a.rating) - ratingRank(b.rating)) * order;
    }
  }
}

// The null-group ordering key: non-null rows (group 0) always precede null rows
// (group 1), regardless of sort direction. `0` when both sides share a group.
function nullGroup(a: unknown, b: unknown): number {
  return (a === null ? 1 : 0) - (b === null ? 1 : 0);
}

// Answer a {@link RunQuery} over an in-memory summary index — the pure filter →
// sort → window the static gallery uses, matched to the backend's offset path so
// a page is identical on either host. `total` is the count of all matching rows
// (before the window); `summaries` is the sorted window (`limit` rows from
// `offset`, or every remaining row when `limit` is omitted).
export function runSummaryPage(
  summaries: readonly RunSummary[],
  query: RunQuery,
): RunQueryResult {
  const sort = query.sort ?? "date";
  const dir = query.dir ?? "desc";
  const offset = query.offset ?? 0;
  // The state slice first, so the current-version scope is measured against the
  // same set the backend measures it against, then the rest of the predicate.
  const inSlice = sliceIsPublished(query) ? summaries : [];
  const scope = currentVersionScope(inSlice, query);
  const filtered = inSlice.filter(
    (s) => matches(s, query) && inVersionScope(s, scope),
  );
  filtered.sort((a, b) => compare(a, b, sort, dir));
  const window =
    query.limit == null
      ? filtered.slice(offset)
      : filtered.slice(offset, offset + query.limit);
  return { summaries: window, total: filtered.length };
}
