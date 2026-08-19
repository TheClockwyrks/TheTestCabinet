import { useEffect, useMemo, useState } from "react";
import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import { Pagination } from "@test-cabinet/ui";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { RunLog, sortStateToQuery, useRunTable } from "../../components/RunLog";
import {
  usePagedSearchParams,
  useResetPageOnChange,
} from "../../components/usePagedSearchParams";
import { useGalleryData } from "../../data/galleryContext";
import { useRunsRuntime } from "../../runtime/runsRuntime";
import type { RunQueryResult } from "../../data/runQuery";
import { GG_CHROME } from "./ggChrome";
import runExec from "../runs/RunExec.module.scss";
import gg from "./GgAnalysis.module.scss";

// How many sessions to show per page. Matches the runs list so the two feel alike.
const PAGE_SIZE = 20;

// The gg harness slug, as recorded on every gg run — what narrows the shared run
// listing to gg's own sessions.
const GG_HARNESS = "gg";

// The gg analysis section's Sessions tab: every recorded gg run, newest first, in
// the same dense run log the rest of the console uses. Today it is also the
// section's index — the widget-builder aggregate surface was removed with the closed
// facet/metric vocabulary it was built on, and the query language replacing it will
// mount Discover, Dashboards and Saved beside this tab.
//
// It is the bridge from an aggregate to the individual sessions behind it: a query
// answers "what happened across runs", and a row here opens the one run — its
// verdict and its telemetry.
// The listing is the ordinary summary query narrowed to the gg harness, so it stays
// in step with the runs list rather than duplicating its paging.
//
// It draws from the **unfiltered** `any` slice rather than the published one every
// other listing defaults to: gg runs are experiment material, published only if
// someone chooses to publish one, and the aggregate surfaces beside this tab count
// every recorded gg run whatever its state. Anything narrower would show an empty
// list next to a dashboard reporting sessions.
export function GgSessionsPage() {
  const { localIds, writeups, queryRunSummaries } = useGalleryData();
  const { page, setPage, query, setQuery, committedQuery } =
    usePagedSearchParams();
  const { refreshToken } = useRunsRuntime();
  const [result, setResult] = useState<RunQueryResult>({
    summaries: [],
    total: 0,
  });
  const [loading, setLoading] = useState(true);

  const needle = committedQuery.trim().toLowerCase();
  const displayed = useMemo<RunSummary[]>(() => result.summaries, [result]);

  const table = useRunTable({
    runs: displayed,
    localIds,
    localWriteups: writeups,
    externalOrder: true,
  });
  const { sort, dir } = sortStateToQuery(table.controls.sort);

  // Re-queried on the runs runtime's refresh token as well as on the page, search,
  // and sort, so a gg session that finishes lands in this list without a reload.
  useEffect(() => {
    let active = true;
    setLoading(true);
    queryRunSummaries({
      state: "any",
      harness: GG_HARNESS,
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
  }, [queryRunSummaries, page, needle, sort, dir, refreshToken]);

  useResetPageOnChange(setPage, `${sort}:${dir}`);

  const pageCount = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);

  useEffect(() => {
    if (!loading && page > pageCount - 1)
      setPage(pageCount - 1, { replace: true });
  }, [loading, page, pageCount, setPage]);

  return (
    <PageLayout chrome={GG_CHROME}>
      <PromptHeader
        command="--gg sessions"
        comment={<>// every recorded gg run, newest first</>}
      />

      <input
        className={runExec.input}
        type="search"
        placeholder="Search by test case or model…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label="Search gg sessions"
      />

      {displayed.length === 0 ? (
        <p className={gg.totalRuns}>
          {loading
            ? "Loading gg sessions…"
            : needle
              ? "No gg sessions match that search."
              : "No gg sessions have been recorded yet."}
        </p>
      ) : (
        <section aria-busy={loading ? "true" : undefined}>
          <RunLog rows={table.rows} controls={table.controls} selectable />
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
