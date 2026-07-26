import { useMemo } from "react";
import { Pagination, Panel } from "@test-cabinet/ui";
import { LoadingState } from "../../../components/LoadingState";
import { RunLog, useRunTable } from "../../../components/RunLog";
import {
  usePagedSearchParams,
  useResetPageOnChange,
} from "../../../components/usePagedSearchParams";
import { useCaseRunSummaries } from "../../../data/useRuns";
import type { TestCaseSummary, VariantSummary } from "../../../data/testCases";
import { TestCaseDetailLayout } from "../../../layouts/testcases/TestCaseDetailLayout";
import styles from "./TestCaseRunsPage.module.scss";

// How many runs to show per page before paging kicks in. Keeps the list from
// rendering hundreds of rows at once on heavily-run cases.
const PAGE_SIZE = 20;

// The Runs tab (`/test-cases/:slug/runs`): the full run log for the selected
// variant, newest first and paged. The case's runs are fetched in one bounded,
// case-scoped query (the backend has no variant filter, so the per-variant
// narrowing — and the sort and paging — happen client-side over the case's bounded
// set). The token/cost distributions live on the Metrics tab.
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
  const { summaries, localIds, localWriteups, loading } = useCaseRunSummaries(
    testCase.slug,
  );
  const { page, setPage } = usePagedSearchParams();

  // Runs of this case and variant, newest first.
  const variantRuns = useMemo(
    () =>
      summaries
        .filter(
          (run) =>
            run.subject.testCaseSlug === testCase.slug &&
            run.subject.variant === variant.slug,
        )
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [summaries, testCase.slug, variant.slug],
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
  useResetPageOnChange(
    setPage,
    `${variant.slug}:${JSON.stringify(table.controls.sort)}`,
  );

  if (variantRuns.length === 0) {
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

  const pageCount = Math.ceil(table.rows.length / PAGE_SIZE);
  // Clamp in case the run set shrank under the current page (e.g. a local run
  // dropped out before the reset effect runs).
  const current = Math.min(page, pageCount - 1);
  const start = current * PAGE_SIZE;
  const pageRows = table.rows.slice(start, start + PAGE_SIZE);

  return (
    <section className={styles.section}>
      <RunLog rows={pageRows} controls={table.controls} />
      <Pagination page={current} pageCount={pageCount} onPageChange={setPage} />
    </section>
  );
}
