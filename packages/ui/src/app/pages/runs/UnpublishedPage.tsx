import { useEffect, useState } from "react";
import { LoadingState } from "../../components/LoadingState";
import { PageLayout } from "../../components/PageLayout";
import { Pagination } from "@test-cabinet/ui";
import { PromptHeader } from "../../components/PromptHeader";
import { RunLog, sortStateToQuery, useRunTable } from "../../components/RunLog";
import { RunsTabs } from "./RunsTabs";
import { RunFilters } from "../../components/RunFilters";
import { useRunFilters } from "../../components/useRunFilters";
import { useResetPageOnChange } from "../../components/usePagedSearchParams";
import { useGalleryData } from "../../data/galleryContext";
import type { RunQueryResult } from "../../data/runQuery";
import { useRunsRuntime } from "../../runtime/runsRuntime";
import styles from "./RunsPage.module.scss";

// How many runs to show per page — matches the all-runs list.
const PAGE_SIZE = 20;

// The publish worklist: runs that have cleared the publish gate but have not been
// released — a reviewed completed run, or a publishable failure tier (which needs
// no review). Newest first, in the same dense run log as the all-runs index, with
// its filter bar, so a backlog can be narrowed to one case or model before it is
// published.
//
// It exists because a publish is asynchronous and can fail (a GitHub 5xx, say)
// long after the console stopped watching the release. When it does, the run
// quietly returns to being "produced but not public" and — in the all-runs listing
// — is indistinguishable from one nobody has got round to publishing. This tab is
// where those runs collect, and where a whole batch of them is published again in
// one gesture: check the rows and right-click to publish the selection.
//
// The slice is deliberately the publish gate rather than "everything unpublished":
// a worklist whose purpose is "select these and publish them" must not list rows
// the backend is about to refuse. Unreviewed runs have their own tab, and
// infrastructure failures can never go public at all.
//
// Console-only — the public gallery holds nothing unpublished by definition, and
// this route is not mounted there.
export function UnpublishedPage() {
  const { queryRunSummaries, localIds, writeups } = useGalleryData();
  const { refreshToken } = useRunsRuntime();
  const filters = useRunFilters();
  const { page, setPage, committedQuery, facets, latestVersions } = filters;
  const [result, setResult] = useState<RunQueryResult>({
    summaries: [],
    total: 0,
  });
  const [loading, setLoading] = useState(true);

  const needle = committedQuery.trim().toLowerCase();

  const table = useRunTable({
    runs: result.summaries,
    localIds,
    localWriteups: writeups,
    externalOrder: true,
  });
  const { sort, dir } = sortStateToQuery(table.controls.sort);

  // Re-queried on `refreshToken` as well as the usual inputs: publishing a
  // selection nudges the runs runtime, and each released run leaves this list.
  useEffect(() => {
    let active = true;
    setLoading(true);
    queryRunSummaries({
      state: "publishable",
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
  }, [
    queryRunSummaries,
    page,
    needle,
    facets,
    latestVersions,
    sort,
    dir,
    refreshToken,
  ]);

  // A re-sort reshapes the whole result set, so return to the first page (the
  // search and facets drop the page param as they are committed).
  useResetPageOnChange(setPage, `${sort}:${dir}`);

  const pageCount = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);

  // A published run leaves this slice, so the total shrinks under the open page
  // more often here than anywhere else — fall back onto the last real page rather
  // than stranding on an out-of-range, empty window.
  useEffect(() => {
    if (!loading && page > pageCount - 1)
      setPage(pageCount - 1, { replace: true });
  }, [loading, page, pageCount, setPage]);

  return (
    <PageLayout>
      <PromptHeader
        command="--runs/unpublished"
        blink
        comment={<>// reviewed, not yet released</>}
      />

      <div className={styles.controls}>
        <RunsTabs active="unpublished" />
        <RunFilters
          state={filters}
          facets={["testCase", "version", "harness", "model"]}
          searchPlaceholder="Search by test case, harness, or model…"
          searchLabel="Search unpublished runs"
        />
      </div>

      {result.summaries.length === 0 ? (
        loading ? (
          <LoadingState size="section" label="Loading runs…" />
        ) : (
          <p className={styles.empty}>
            {filters.activeCount > 0
              ? "No unpublished runs match those filters."
              : "Nothing waiting to publish — every reviewed run is public."}
          </p>
        )
      ) : (
        <section
          className={styles.results}
          aria-busy={loading ? "true" : undefined}
        >
          <p className={styles.hint}>
            Check the runs to release, then right-click to publish the
            selection.
          </p>
          <RunLog
            rows={table.rows}
            active={[]}
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
