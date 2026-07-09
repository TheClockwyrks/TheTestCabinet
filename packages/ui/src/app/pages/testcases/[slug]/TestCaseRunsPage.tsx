import { useEffect, useMemo, useState } from "react";
import { Pagination, Panel } from "@test-cabinet/ui";
import { RunLog, useRunTable } from "../../../components/RunLog";
import { useRunSummaries } from "../../../data/useRuns";
import type { TestCaseSummary, VariantSummary } from "../../../data/testCases";
import { TestCaseDetailLayout } from "../../../layouts/testcases/TestCaseDetailLayout";
import styles from "./TestCaseRunsPage.module.scss";

// How many runs to show per page before paging kicks in. Keeps the list from
// rendering hundreds of rows at once on heavily-run cases.
const PAGE_SIZE = 20;

// The Runs tab (`/test-cases/:slug/runs`): the full run log for the selected
// variant, newest first and paged. The token/cost distributions live on the
// Metrics tab. Rows default to recency order; the run log's headers re-sort the
// whole variant history, which is then paged.
export function TestCaseRunsPage() {
  return (
    <TestCaseDetailLayout tab="runs">
      {({ testCase, variant }) => (
        <RunsContent testCase={testCase} variant={variant} />
      )}
    </TestCaseDetailLayout>
  );
}

function RunsContent({
  testCase,
  variant,
}: {
  testCase: TestCaseSummary;
  variant: VariantSummary;
}) {
  const { runSummaries, localIds, localWriteups } = useRunSummaries();
  const [page, setPage] = useState(0);

  // Runs of this case and variant, newest first.
  const variantRuns = useMemo(
    () =>
      runSummaries
        .filter(
          (run) =>
            run.subject.testCaseSlug === testCase.slug &&
            run.subject.variant === variant.slug,
        )
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [runSummaries, testCase.slug, variant.slug],
  );

  // Enrich and sort the full variant history before paging, so a header sort
  // orders the whole set rather than just the current page.
  const table = useRunTable({
    runs: variantRuns,
    localIds,
    localWriteups,
    scope: "variant",
  });

  // Switching variants swaps the whole run set, and re-sorting reshapes it, so
  // jump back to the first page in either case.
  useEffect(() => {
    setPage(0);
  }, [variant.slug, table.controls.sort]);

  if (variantRuns.length === 0) {
    return (
      <section className={styles.section}>
        <Panel>
          <p className={styles.empty}>No runs of {variant.name} yet.</p>
        </Panel>
      </section>
    );
  }

  const pageCount = Math.ceil(table.rows.length / PAGE_SIZE);
  // Clamp in case the run set shrank under the current page (e.g. a local run
  // dropped out before the reset effect runs).
  const current = Math.min(page, pageCount - 1);
  const start = current * PAGE_SIZE;
  const pageRows = table.rows.slice(start, start + PAGE_SIZE);

  return (
    <section className={styles.section}>
      <RunLog rows={pageRows} controls={table.controls} />
      <Pagination
        page={current}
        pageCount={pageCount}
        onPageChange={setPage}
      />
    </section>
  );
}
