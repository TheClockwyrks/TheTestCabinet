import { useEffect, useState } from "react";
import { Pagination, Panel } from "@clockwyrks/ui";
import { LoadingState } from "../../../components/LoadingState";
import {
  RunLog,
  sortStateToQuery,
  useRunTable,
} from "../../../components/RunLog";
import { RunFilters } from "../../../components/RunFilters";
import {
  useRunFilters,
  type RunFilterState,
} from "../../../components/useRunFilters";
import { useResetPageOnChange } from "../../../components/usePagedSearchParams";
import {
  AnchoredScopeControls,
  useAnchoredScope,
} from "../../../components/anchoredScope";
import type { RunScope } from "../../../components/runColumns";
import { useGalleryData } from "../../../data/galleryContext";
import { engineName } from "../../../data/engines";
import type { RunQueryResult } from "../../../data/runQuery";
import {
  TestCaseDetailLayout,
  type DetailTabContext,
} from "../../../layouts/testcases/TestCaseDetailLayout";
import { useRunsRuntime } from "../../../runtime/runsRuntime";
import styles from "./TestCaseRunsPage.module.scss";

// How many runs to show per page before paging kicks in. Keeps the list from
// rendering hundreds of rows at once on heavily-run cases.
const PAGE_SIZE = 20;

// The Runs tab (`/test-cases/:slug/runs`): the full run log for the page's
// anchored coordinate, newest first and paged. The tab aggregates runs rather
// than rendering the deliverable, so it scopes *relative to* the anchor: the
// anchored version's `major.minor` line by default (widenable to the exact
// version, the major line, or every version), the anchored engine (widenable to
// all where the version supports more than one), and the anchored variant
// (widenable to all where the version declares more than one). Each page is one
// server query under that scope (the console's backend offset endpoint, the
// static site's in-memory index), so the tab holds a single page rather than
// the case's whole history: a header sort re-queries in that order, and an
// unpublished (so unreviewed) run sorts and pages among the published ones. The
// token/cost distributions live on the Metrics tab.
export function TestCaseRunsPage() {
  return (
    <TestCaseDetailLayout tab="runs">
      {(ctx) => <RunsContent {...ctx} />}
    </TestCaseDetailLayout>
  );
}

// The run log body, given the anchored coordinate. Exported so the game-jam
// detail's Runs tab renders the identical log under its own layout — the
// per-run badge (a jam's overall grade, a test case's rating) is resolved by
// the shared run columns, and a jam (engineless, single-variant, one version in
// practice) simply has no wideners to offer, so nothing here is
// case-type-specific.
export function RunsContent({
  testCase,
  version,
  engine,
  variant,
}: DetailTabContext) {
  // A widener is only honored where its control is offered: the engine widener
  // when the anchored version supports more than one engine, the variant
  // widener when it declares more than one variant. The hook enforces it (a
  // stale `?engines=all` on a single-engine version must not silently change
  // the query behind a control that isn't on screen); the flags also gate the
  // controls below.
  const multiEngine = (testCase.enginesByVersion[version] ?? []).length > 1;
  const multiVariant = (testCase.variantsByVersion[version] ?? []).length > 1;
  const scope = useAnchoredScope({
    version,
    versions: testCase.versions,
    engineWidenable: multiEngine,
    variantWidenable: multiVariant,
  });
  // The case is pinned by the route and the `?version=` param is the anchored
  // coordinate's, not a facet — pin both out of the filter bar's hands.
  const filters = useRunFilters({ testCase: testCase.slug, version: "" });

  const allEngines = scope.engineScope === "all";
  const allVariants = scope.variantScope === "all";

  // Widened to all variants the rows differ by variant (and engine), so the
  // table keeps those columns; anchored to one variant they'd be constant.
  const tableScope: RunScope = allVariants ? "case" : "variant";
  // What the empty states call the cohort: the variant while scoped to one, the
  // case once widened across them.
  const subjectName = allVariants ? testCase.name : variant.name;
  // Whether any scope control is narrowing the cohort right now, so an empty
  // listing can point at the controls that would widen it.
  const narrowed =
    (scope.showVersions && scope.versionScope !== "all") ||
    (multiEngine && !allEngines) ||
    (multiVariant && !allVariants);

  // Changing what the tab is anchored to or how far the scope reaches reshapes
  // the whole result set, so jump back to the first page. (A new search or
  // facet drops the page param as it is committed; the sort lives with the
  // table below and carries its own reset.)
  useResetPageOnChange(
    filters.setPage,
    [
      testCase.slug,
      variant.slug,
      version,
      engine,
      scope.versionScope,
      allEngines,
      allVariants,
    ].join(":"),
  );

  return (
    <section className={styles.section}>
      {/* The scope row first — the tab's own axes, relative to the anchor —
          then the filter bar with the harness/model axes a case's history is
          actually compared along (version scoping happens above, so the bar
          carries neither the version facet nor the current-versions toggle).
          Both stay put when the result set empties, so an over-narrow scope or
          filter can be widened again. */}
      <div className={styles.controls}>
        <AnchoredScopeControls
          state={scope}
          engine={multiEngine ? { name: engineName(engine) } : undefined}
          variant={multiVariant ? { name: variant.name } : undefined}
        />
        <RunFilters
          state={filters}
          facets={["harness", "model"]}
          searchPlaceholder="Search these runs by harness or model…"
          searchLabel={`Search ${testCase.name} runs`}
        />
      </div>

      {/* Keyed by the table scope so flipping the variant widening REMOUNTS the
          log: the sort and column-visibility hooks load their persisted state
          once per mount from per-scope localStorage keys, so an in-place scope
          swap would carry one scope's state over and save it under the other's
          key. A remount keeps `variant` and `case` cleanly apart. */}
      <ScopedRunLog
        key={tableScope}
        tableScope={tableScope}
        testCaseSlug={testCase.slug}
        versionsInScope={scope.versionsInScope}
        engine={allEngines ? null : engine}
        variantSlug={allVariants ? null : variant.slug}
        filters={filters}
        subjectName={subjectName}
        narrowed={narrowed}
      />
    </section>
  );
}

// One page of the scoped run log: the server query, the table, and the pager.
// Split from {@link RunsContent} so it can be remounted (via `key`) when the
// table scope flips — see the call site.
function ScopedRunLog({
  tableScope,
  testCaseSlug,
  versionsInScope,
  engine,
  variantSlug,
  filters,
  subjectName,
  narrowed,
}: {
  tableScope: RunScope;
  testCaseSlug: string;
  /** The concrete versions the anchored scope selects, or null for all. */
  versionsInScope: string[] | null;
  /** The engine to filter to, or null when widened to all engines. */
  engine: string | null;
  /** The variant to filter to, or null when widened to all variants. */
  variantSlug: string | null;
  filters: RunFilterState;
  /** What the empty states call the cohort. */
  subjectName: string;
  /** Whether a scope control is narrowing the cohort, so an empty listing can
   * point at it. */
  narrowed: boolean;
}) {
  const { localIds, writeups, queryRunSummaries } = useGalleryData();
  const { refreshToken } = useRunsRuntime();
  const { page, setPage, committedQuery, facets } = filters;
  const [result, setResult] = useState<RunQueryResult>({
    summaries: [],
    total: 0,
  });
  const [loading, setLoading] = useState(true);

  const needle = committedQuery.trim().toLowerCase();

  // The table renders the server-ordered page as-is (externalOrder) but still owns
  // the sort state, so its headers drive the re-query below.
  const table = useRunTable({
    runs: result.summaries,
    localIds,
    localWriteups: writeups,
    scope: tableScope,
    externalOrder: true,
  });
  const { sort, dir } = sortStateToQuery(table.controls.sort);

  // A stable dependency for the version list, which the effect rebuilds from:
  // the scope recreates the array identity each render, so depending on the
  // array itself would re-fire the fetch (and its setState) every render. A
  // version directory name cannot contain a comma, so the join is lossless.
  const versionsKey = versionsInScope ? versionsInScope.join(",") : null;

  // Fetch one page whenever the scope, the filters, the active sort, or the page
  // changes — and whenever the runs runtime bumps its refresh token, so a run of
  // this case that finishes appears here rather than waiting on a reload.
  useEffect(() => {
    let active = true;
    setLoading(true);
    queryRunSummaries({
      // Every run this host holds for the scope — produced ones included, ordered
      // with the published rows rather than ahead of them.
      state: "any",
      testCase: testCaseSlug,
      // The anchored version scope travels as the concrete list the catalog
      // resolves it to (which also silences the current-version default). Widened
      // to every version there is no version filter at all — said explicitly, so
      // "all" really is the case's whole history.
      ...(versionsKey != null
        ? { versions: versionsKey.split(",") }
        : { latestVersions: false }),
      // Anchored engine/variant scopes are equality filters; widened, the filter
      // is simply omitted.
      ...(engine != null ? { engine } : {}),
      ...(variantSlug != null ? { variant: variantSlug } : {}),
      offset: page * PAGE_SIZE,
      limit: PAGE_SIZE,
      q: needle || undefined,
      harness: facets.harness || undefined,
      model: facets.model || undefined,
      sort,
      dir,
    })
      .then((res) => {
        if (!active) return;
        setResult(res);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setResult({ summaries: [], total: 0 });
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    queryRunSummaries,
    testCaseSlug,
    versionsKey,
    engine,
    variantSlug,
    page,
    needle,
    facets,
    sort,
    dir,
    refreshToken,
  ]);

  // Re-sorting reshapes the result set, so jump back to the first page. (The
  // anchor and scope changes reset it from the parent, which outlives this
  // remountable table.)
  useResetPageOnChange(setPage, `${sort}:${dir}`);

  const pageCount = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);

  // If the result set shrank under the current page (the total dropped below the
  // requested offset), fall back onto the last real page so the list can't strand
  // on an out-of-range, empty window.
  useEffect(() => {
    if (!loading && page > pageCount - 1)
      setPage(pageCount - 1, { replace: true });
  }, [loading, page, pageCount, setPage]);

  return (
    <div aria-busy={loading ? "true" : undefined}>
      {result.summaries.length === 0 ? (
        <Panel>
          {loading ? (
            <LoadingState size="section" label="Loading runs…" />
          ) : filters.activeCount > 0 ? (
            <p className={styles.empty}>
              No runs of {subjectName} match those filters.
            </p>
          ) : narrowed ? (
            <p className={styles.empty}>
              No runs of {subjectName} in this scope yet. Widening the scope
              above may show more.
            </p>
          ) : (
            <p className={styles.empty}>No runs of {subjectName} yet.</p>
          )}
        </Panel>
      ) : (
        <>
          <RunLog rows={table.rows} controls={table.controls} />
          <Pagination
            page={current}
            pageCount={pageCount}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
