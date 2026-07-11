import { useEffect, useState } from "react";
import { Link } from "react-router";
import { PageLayout } from "../../components/PageLayout";
import { Pagination } from "@test-cabinet/ui";
import { PromptHeader } from "../../components/PromptHeader";
import { RunLog, sortStateToQuery, useRunTable } from "../../components/RunLog";
import { usePagedSearchParams } from "../../components/usePagedSearchParams";
import { useGalleryData } from "../../data/galleryContext";
import type { RunQueryResult } from "../../data/runQuery";
import { routes } from "../../routes";
import styles from "./RunsPage.module.scss";
import exec from "./RunExec.module.scss";

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
  }, [queryRunSummaries, page, sort, dir]);

  const pageCount = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);

  return (
    <PageLayout>
      <div className={exec.runsHeader}>
        <PromptHeader
          command="--runs/unreviewed"
          comment={<>// completed runs nobody has reviewed yet</>}
        />
        <span className={exec.headerActions}>
          <Link className={exec.secondary} to={routes.runs()}>
            All runs
          </Link>
          <Link className={exec.secondary} to={routes.runCoverage()}>
            Coverage
          </Link>
        </span>
      </div>

      {result.summaries.length === 0 ? (
        loading ? (
          <p className={styles.empty}>Loading runs…</p>
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
