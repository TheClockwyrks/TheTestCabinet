import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { PageLayout } from "../../components/PageLayout";
import { Pagination } from "@test-cabinet/ui";
import { PromptHeader } from "../../components/PromptHeader";
import { RunLog, sortStateToQuery, useRunTable } from "../../components/RunLog";
import { RunsTabs } from "./RunsTabs";
import { RunFilters } from "../../components/RunFilters";
import { useRunFilters } from "../../components/useRunFilters";
import { useResetPageOnChange } from "../../components/usePagedSearchParams";
import { useFindModel } from "../../data/useModels";
import type { ModelSummary } from "../../data/models";
import { useGalleryData, type InProgressRun } from "../../data/galleryContext";
import type { RunQueryResult } from "../../data/runQuery";
import { useRunsRuntime } from "../../runtime/runsRuntime";
import { formatSlug } from "../../format";
import { routes } from "../../routes";
import styles from "./RunsPage.module.scss";
import exec from "./RunExec.module.scss";

// How many runs to show per page before paging kicks in. Keeps the list from
// rendering hundreds of rows at once across the whole cabinet.
const PAGE_SIZE = 20;

// The all-runs index: every recorded run — published and produced-but-unpublished
// alike — newest first, in the same dense run log the home page leads with, but
// here the full history is browsable a page at a time. Each page is a server query
// (the console's backend offset endpoint, the static site's in-memory index), so
// only one page of summaries is ever held: a header sort re-queries in that order,
// and the filter bar's debounced search and equality facets narrow server-side. An
// unpublished (and so unreviewed) run takes its place in that one sorted, paged
// order — the consoles draw from the backend's `any` slice rather than merging a
// locally-held worklist in ahead of it. Only in-progress runs, which have no record
// to list yet, are still pinned to the first page.
export function RunsPage() {
  const { canExecute, localIds, writeups, queryRunSummaries } =
    useGalleryData();
  const { inProgress } = useRunsRuntime();
  const findModel = useFindModel();
  const filters = useRunFilters();
  const { page, setPage, committedQuery, facets, latestVersions } = filters;
  const [result, setResult] = useState<RunQueryResult>({
    summaries: [],
    total: 0,
  });
  const [loading, setLoading] = useState(true);

  const needle = committedQuery.trim().toLowerCase();

  // Runs still executing, narrowed by the same search and facets so the list
  // behaves uniformly. Only the consoles have these (the static site's runtime is
  // always empty).
  //
  // The current-version toggle is deliberately not applied: an in-progress run has
  // no recorded cohort to measure against, and a run launched a minute ago —
  // whatever version it targets — is exactly what this list exists to show.
  const activeRuns = useMemo(() => {
    if (!canExecute) return [];
    return inProgress.filter(
      (run) =>
        (!needle || activeSearchText(run, findModel).includes(needle)) &&
        (!facets.testCase || run.testCaseSlug === facets.testCase) &&
        (!facets.version || run.testCaseVersion === facets.version) &&
        (!facets.harness || run.harnessSlug === facets.harness) &&
        (!facets.model || run.modelId === facets.model),
    );
  }, [canExecute, inProgress, needle, findModel, facets]);

  // The table renders the server-ordered page as-is (externalOrder) but still owns
  // the sort state, so its headers drive the re-query below.
  const table = useRunTable({
    runs: result.summaries,
    localIds,
    localWriteups: writeups,
    externalOrder: true,
  });
  const { sort, dir } = sortStateToQuery(table.controls.sort);

  // Fetch one page whenever the search, the active sort, or the page changes. The
  // prior rows stay on screen until the new page resolves (no empty flash).
  useEffect(() => {
    let active = true;
    setLoading(true);
    queryRunSummaries({
      // Every run this host holds — published and produced-but-unpublished alike —
      // so an unreviewed run sorts and pages with the rest. On the public gallery
      // that is simply the published index.
      state: "any",
      offset: page * PAGE_SIZE,
      limit: PAGE_SIZE,
      q: needle || undefined,
      testCase: facets.testCase || undefined,
      version: facets.version || undefined,
      harness: facets.harness || undefined,
      model: facets.model || undefined,
      latestVersions,
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
  }, [queryRunSummaries, page, needle, facets, latestVersions, sort, dir]);

  // A new search or facet resets to the first page as it is committed (both drop
  // the page param); a re-sort of the whole history reshapes the result set the
  // same way, so jump back to the first page here.
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

  // In-progress runs lead the list, pinned to the first page so they don't repeat.
  const showActive = activeRuns.length > 0 && current === 0;
  const hasContent = result.summaries.length > 0 || showActive;

  return (
    <PageLayout>
      <div className={exec.runsHeader}>
        <PromptHeader
          command="--runs"
          blink
          comment={<>// every result the cabinet has produced</>}
        />
        {canExecute && (
          <div className={exec.headerActions}>
            <Link className={exec.secondary} to={routes.accountCoverage()}>
              Coverage plans
            </Link>
            <Link className={exec.primary} to={routes.runNew()}>
              + New run
            </Link>
          </div>
        )}
      </div>

      <div className={styles.controls}>
        <RunsTabs active="runs" />
        <RunFilters
          state={filters}
          facets={["testCase", "version", "harness", "model"]}
          searchPlaceholder="Search by test case, harness, or model…"
          searchLabel="Search runs"
        />
      </div>

      {!hasContent ? (
        loading ? (
          <p className={styles.empty}>Loading runs…</p>
        ) : (
          <p className={styles.empty}>
            {filters.activeCount > 0
              ? "No runs match those filters."
              : "No runs have been published yet."}
          </p>
        )
      ) : (
        <section
          className={styles.results}
          aria-busy={loading ? "true" : undefined}
        >
          <RunLog
            rows={table.rows}
            active={showActive ? activeRuns : []}
            controls={table.controls}
            selectable
          />
          <Pagination
            page={current}
            pageCount={pageCount}
            onPageChange={setPage}
          />
        </section>
      )}
    </PageLayout>
  );
}

// Case-insensitive haystack for an in-progress run: its test case (display name
// and slug), harness, model (catalog name and raw id), and variant. Finished rows
// are narrowed by the server's own free-text match over the recorded identity
// columns; an in-progress run has no record to query, so it is matched here.
function activeSearchText(
  run: InProgressRun,
  findModel: (id: string, harness?: string) => ModelSummary | undefined,
): string {
  const model = findModel(run.modelId, run.harnessSlug);
  return [
    formatSlug(run.testCaseSlug),
    run.testCaseSlug,
    run.harnessSlug,
    run.variant,
    model?.name ?? "",
    run.modelId,
  ]
    .join(" ")
    .toLowerCase();
}
