import { useEffect, useState } from "react";
import { LoadingState } from "../../components/LoadingState";
import { PageLayout } from "../../components/PageLayout";
import { Pagination } from "@test-cabinet/ui";
import { PromptHeader } from "../../components/PromptHeader";
import { RunLog, sortStateToQuery, useRunTable } from "../../components/RunLog";
import { RunsTabs } from "./RunsTabs";
import { StopRunsControls, useCanStopRuns } from "./StopRunsControls";
import { usePagedSearchParams } from "../../components/usePagedSearchParams";
import { useGalleryData } from "../../data/galleryContext";
import type { RunQueryResult } from "../../data/runQuery";
import { useRunsRuntime } from "../../runtime/runsRuntime";
import styles from "./RunsPage.module.scss";

// How many runs to show per page — matches the all-runs list.
const PAGE_SIZE = 20;

// The unreviewed worklist: completed runs no account has reviewed yet, newest
// first. A reviewer opens this to find the runs that still need a first pass,
// instead of scanning the whole runs list for gaps. Each page is a server query
// against the backend's `state=unreviewed` slice (completed with `reviewCount 0`);
// a header sort re-queries in that order. Console-only — the static site holds no
// unpublished/unreviewed runs, and this route is not mounted there.
export function UnreviewedPage() {
  const { queryRunSummaries, localIds, writeups } = useGalleryData();
  const { page, setPage } = usePagedSearchParams();
  const { refreshToken } = useRunsRuntime();
  const canStop = useCanStopRuns();
  const [result, setResult] = useState<RunQueryResult>({
    summaries: [],
    total: 0,
  });
  const [loading, setLoading] = useState(true);

  const table = useRunTable({
    runs: result.summaries,
    localIds,
    localWriteups: writeups,
    externalOrder: true,
  });
  const { sort, dir } = sortStateToQuery(table.controls.sort);

  // Re-queried on the runs runtime's refresh token as well as on the page and
  // sort, so a run that finishes (or is reviewed, published, or deleted elsewhere
  // in the console) joins or leaves this worklist without a reload.
  useEffect(() => {
    let active = true;
    setLoading(true);
    queryRunSummaries({
      state: "unreviewed",
      offset: page * PAGE_SIZE,
      limit: PAGE_SIZE,
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
  }, [queryRunSummaries, page, sort, dir, refreshToken]);

  const pageCount = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);

  return (
    <PageLayout>
      <PromptHeader
        command="--runs/unreviewed"
        comment={
          <>
            // completed runs nobody has reviewed yet — a validator-rated run
            already carries its functional rating and can be published as is;
            its aesthetic review can be added later
          </>
        }
        actions={canStop ? <StopRunsControls /> : undefined}
      />

      <RunsTabs active="unreviewed" />

      {result.summaries.length === 0 ? (
        loading ? (
          <LoadingState size="section" label="Loading runs…" />
        ) : (
          <p className={styles.empty}>
            Nothing to review — every completed run has at least one review.
          </p>
        )
      ) : (
        <section
          className={styles.results}
          aria-busy={loading ? "true" : undefined}
        >
          <RunLog rows={table.rows} active={[]} controls={table.controls} />
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
