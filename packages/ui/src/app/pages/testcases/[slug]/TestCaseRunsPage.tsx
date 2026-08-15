import { useEffect, useState } from "react";
import { Pagination, Panel } from "@test-cabinet/ui";
import { LoadingState } from "../../../components/LoadingState";
import {
  RunLog,
  sortStateToQuery,
  useRunTable,
} from "../../../components/RunLog";
import {
  usePagedSearchParams,
  useResetPageOnChange,
} from "../../../components/usePagedSearchParams";
import { useGalleryData } from "../../../data/galleryContext";
import type { RunQueryResult } from "../../../data/runQuery";
import type { TestCaseSummary, VariantSummary } from "../../../data/testCases";
import { TestCaseDetailLayout } from "../../../layouts/testcases/TestCaseDetailLayout";
import styles from "./TestCaseRunsPage.module.scss";

// How many runs to show per page before paging kicks in. Keeps the list from
// rendering hundreds of rows at once on heavily-run cases.
const PAGE_SIZE = 20;

// The Runs tab (`/test-cases/:slug/runs`): the full run log for the selected
// variant, newest first and paged. Each page is one server query scoped to the
// case and variant (the console's backend offset endpoint, the static site's
// in-memory index), so the tab holds a single page rather than the case's whole
// history: a header sort re-queries in that order, and an unpublished (so
// unreviewed) run sorts and pages among the published ones. The token/cost
// distributions live on the Metrics tab, which does aggregate over the whole
// case-scoped set.
export function TestCaseRunsPage() {
  return (
    <TestCaseDetailLayout tab="runs">
      {({ testCase, variant }) => (
        <RunsContent testCase={testCase} variant={variant} />
      )}
    </TestCaseDetailLayout>
  );
}

// The run log body, given the resolved case and variant. Exported so the
// game-jam detail's Runs tab renders the identical log under its own layout — the
// per-run badge (a jam's overall grade, a test case's rating) is resolved by the
// shared run columns, so nothing here is case-type-specific.
export function RunsContent({
  testCase,
  variant,
}: {
  testCase: TestCaseSummary;
  variant: VariantSummary;
}) {
  const { localIds, writeups, queryRunSummaries } = useGalleryData();
  const { page, setPage } = usePagedSearchParams();
  const [result, setResult] = useState<RunQueryResult>({
    summaries: [],
    total: 0,
  });
  const [loading, setLoading] = useState(true);

  // The table renders the server-ordered page as-is (externalOrder) but still owns
  // the sort state, so its headers drive the re-query below.
  const table = useRunTable({
    runs: result.summaries,
    localIds,
    localWriteups: writeups,
    scope: "variant",
    externalOrder: true,
  });
  const { sort, dir } = sortStateToQuery(table.controls.sort);

  // Fetch one page whenever the case/variant, the active sort, or the page changes.
  useEffect(() => {
    let active = true;
    setLoading(true);
    queryRunSummaries({
      // Every run this host holds for the variant — produced ones included, ordered
      // with the published rows rather than ahead of them.
      state: "any",
      testCase: testCase.slug,
      variant: variant.slug,
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
  }, [queryRunSummaries, testCase.slug, variant.slug, page, sort, dir]);

  // Switching cases or variants swaps the whole run set, and re-sorting reshapes
  // it, so jump back to the first page in any of those cases.
  useResetPageOnChange(
    setPage,
    `${testCase.slug}:${variant.slug}:${sort}:${dir}`,
  );

  const pageCount = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);

  // If the result set shrank under the current page (the total dropped below the
  // requested offset), fall back onto the last real page so the list can't strand
  // on an out-of-range, empty window.
  useEffect(() => {
    if (!loading && page > pageCount - 1)
      setPage(pageCount - 1, { replace: true });
  }, [loading, page, pageCount, setPage]);

  if (result.summaries.length === 0) {
    return (
      <section className={styles.section}>
        <Panel>
          {loading ? (
            <LoadingState size="section" label="Loading runs…" />
          ) : (
            <p className={styles.empty}>No runs of {variant.name} yet.</p>
          )}
        </Panel>
      </section>
    );
  }

  return (
    <section
      className={styles.section}
      aria-busy={loading ? "true" : undefined}
    >
      <RunLog rows={table.rows} controls={table.controls} />
      <Pagination page={current} pageCount={pageCount} onPageChange={setPage} />
    </section>
  );
}
