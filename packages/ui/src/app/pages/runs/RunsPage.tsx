import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { PageLayout } from "../../components/PageLayout";
import { Pagination } from "@test-cabinet/ui";
import { PromptHeader } from "../../components/PromptHeader";
import { RunLog, sortStateToQuery, useRunTable } from "../../components/RunLog";
import { useDebouncedValue } from "../../components/useDebouncedValue";
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

// The all-runs index: every published (and locally produced) run, newest first,
// in the same dense run log the home page leads with — but here the full history
// is browsable a page at a time. Each page is a server query (the console's backend
// offset endpoint, the static site's in-memory index), so only one page of
// summaries is ever held: a header sort re-queries in that order, and the search
// narrows by test case, harness, or model. Produced (local, unpublished) and
// in-progress runs lead the first page, pinned so they don't repeat across pages.
export function RunsPage() {
  const { canExecute, producedSummaries, localIds, writeups, queryRunSummaries } =
    useGalleryData();
  const { inProgress } = useRunsRuntime();
  const findModel = useFindModel();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 250);
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<RunQueryResult>({
    summaries: [],
    total: 0,
  });
  const [loading, setLoading] = useState(true);

  const needle = debouncedQuery.trim().toLowerCase();

  // Produced (local) runs matching the search, pinned to the first page ahead of
  // the queried published window (the backend's numbered listing never returns
  // them). Off the first page they are omitted so they don't repeat.
  const produced = useMemo(() => {
    if (!needle) return producedSummaries;
    return producedSummaries.filter((run) =>
      searchText(run, findModel).includes(needle),
    );
  }, [producedSummaries, needle, findModel]);

  // Runs still executing, narrowed by the same search so it behaves uniformly.
  // Only the consoles have these (the static site's runtime is always empty).
  const activeRuns = useMemo(() => {
    if (!canExecute) return [];
    if (!needle) return inProgress;
    return inProgress.filter((run) =>
      activeSearchText(run, findModel).includes(needle),
    );
  }, [canExecute, inProgress, needle, findModel]);

  // On the first page the local/produced runs lead the server window; off it, only
  // the server page (the local runs stay pinned to page 0).
  const displayed = useMemo<RunSummary[]>(
    () => (page === 0 ? [...produced, ...result.summaries] : result.summaries),
    [page, produced, result.summaries],
  );

  // The table renders the server-ordered page as-is (externalOrder) but still owns
  // the sort state, so its headers drive the re-query below.
  const table = useRunTable({
    runs: displayed,
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
      state: "published",
      offset: page * PAGE_SIZE,
      limit: PAGE_SIZE,
      q: needle || undefined,
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
  }, [queryRunSummaries, page, needle, sort, dir]);

  // A new search — or a re-sort of the whole history — reshapes the result set, so
  // jump back to the first page.
  useEffect(() => {
    setPage(0);
  }, [needle, sort, dir]);

  const pageCount = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);

  // If the result set shrank under the current page (the total dropped below the
  // requested offset), fall back onto the last real page so the list can't strand
  // on an out-of-range, empty window.
  useEffect(() => {
    if (!loading && page > pageCount - 1) setPage(pageCount - 1);
  }, [loading, page, pageCount]);

  // In-progress runs lead the list, pinned to the first page so they don't repeat.
  const showActive = activeRuns.length > 0 && current === 0;
  const hasContent = displayed.length > 0 || showActive;

  return (
    <PageLayout>
      <div className={exec.runsHeader}>
        <PromptHeader
          command="--runs"
          blink
          comment={<>// every result the cabinet has produced</>}
        />
        {canExecute && (
          <span className={exec.headerActions}>
            <Link className={exec.secondary} to={routes.runFailures()}>
              Publish failures
            </Link>
            <Link className={exec.primary} to={routes.runNew()}>
              + New run
            </Link>
          </span>
        )}
      </div>

      <div className={styles.controls}>
        <input
          className={styles.search}
          type="search"
          placeholder="Search by test case, harness, or model…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search runs"
        />
      </div>

      {!hasContent ? (
        loading ? (
          <p className={styles.empty}>Loading runs…</p>
        ) : (
          <p className={styles.empty}>
            {needle
              ? "No runs match that search."
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

// Case-insensitive haystack for a single run: its test case (display name and
// slug), harness, and model (catalog name and raw id). Only these three subjects
// are searchable — difficulty and tags are deliberately absent here.
function searchText(
  run: RunSummary,
  findModel: (id: string, harness?: string) => ModelSummary | undefined,
): string {
  const { subject } = run;
  const model = findModel(subject.modelId, subject.harnessSlug);
  return [
    formatSlug(subject.testCaseSlug),
    subject.testCaseSlug,
    subject.harnessSlug,
    model?.name ?? "",
    subject.modelId,
  ]
    .join(" ")
    .toLowerCase();
}

// Case-insensitive haystack for an in-progress run: the same three subjects as a
// finished row (test case, harness, model) plus its variant, so the search
// narrows live and finished runs alike.
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
