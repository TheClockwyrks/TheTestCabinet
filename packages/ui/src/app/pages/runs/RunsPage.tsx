import type { RunRecord } from "@test-cabinet/run-record";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { PageLayout } from "../../components/PageLayout";
import { Pagination } from "@test-cabinet/ui";
import { PromptHeader } from "../../components/PromptHeader";
import { RunLog } from "../../components/RunLog";
import { findModelByModelId } from "../../data/models";
import { useGalleryData, type InProgressRun } from "../../data/galleryContext";
import { useRuns } from "../../data/useRuns";
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
// is browsable a page at a time rather than just the most recent results, and a
// search narrows by test case, harness, or model name. It carries no featured
// run and shows no ranking — rows are ordered purely by recency (docs/site.md).
export function RunsPage() {
  const { runs, localIds, localWriteups } = useRuns();
  const { canExecute } = useGalleryData();
  const { inProgress } = useRunsRuntime();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  // Every run, newest first, then narrowed by the free-text query.
  const matched = useMemo(() => {
    const recent = [...runs].sort(byRecencyDesc);
    const needle = query.trim().toLowerCase();
    if (!needle) return recent;
    return recent.filter((run) => searchText(run).includes(needle));
  }, [runs, query]);

  // Runs still executing, narrowed by the same query so search behaves uniformly.
  // Only the consoles have these (the static site's runtime is always empty).
  const activeRuns = useMemo(() => {
    if (!canExecute) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return inProgress;
    return inProgress.filter((run) =>
      activeSearchText(run).includes(needle),
    );
  }, [canExecute, inProgress, query]);

  // A new query reshapes the result set, so jump back to the first page.
  useEffect(() => {
    setPage(0);
  }, [query]);

  const pageCount = Math.max(1, Math.ceil(matched.length / PAGE_SIZE));
  // Clamp in case the result set shrank under the current page (e.g. a local
  // run dropped out before a reset, or the query tightened).
  const current = Math.min(page, pageCount - 1);
  const start = current * PAGE_SIZE;
  const pageRuns = matched.slice(start, start + PAGE_SIZE);
  // In-progress runs lead the list, pinned to the first page so they don't repeat
  // across pages. A run only here until it finishes — then it joins `matched`.
  const showActive = activeRuns.length > 0 && current === 0;
  const hasContent = matched.length > 0 || showActive;

  return (
    <PageLayout>
      <div className={exec.runsHeader}>
        <PromptHeader
          command="--runs"
          blink
          comment={<>// every result the cabinet has produced</>}
        />
        {canExecute && (
          <Link className={exec.primary} to={routes.runNew()}>
            + New run
          </Link>
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
        <p className={styles.empty}>
          {runs.length === 0
            ? "No runs have been published yet."
            : "No runs match that search."}
        </p>
      ) : (
        <section className={styles.results}>
          <RunLog
            runs={pageRuns}
            active={showActive ? activeRuns : []}
            localIds={localIds}
            localWriteups={localWriteups}
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
function searchText(run: RunRecord): string {
  const { subject } = run;
  const model = findModelByModelId(subject.modelId);
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
function activeSearchText(run: InProgressRun): string {
  const model = findModelByModelId(run.modelId);
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

// Newest first, by finish time, falling back to start time when a run never
// recorded a finish (e.g. it failed before completing). Matches the home page.
function byRecencyDesc(a: RunRecord, b: RunRecord): number {
  return timestamp(b) - timestamp(a);
}

function timestamp(run: RunRecord): number {
  const value = Date.parse(run.finishedAt || run.startedAt);
  return Number.isNaN(value) ? 0 : value;
}
