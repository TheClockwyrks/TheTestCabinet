import { useEffect, useMemo, useState } from "react";
import { Pagination, Panel, canonicalModelId } from "@test-cabinet/ui";
import { RunLog, useRunTable } from "../../../components/RunLog";
import type { ModelSummary } from "../../../data/models";
import { useRuns } from "../../../data/useRuns";
import { ModelDetailLayout } from "../../../layouts/models/ModelDetailLayout";
import styles from "./ModelRunsPage.module.scss";

// How many runs to show per page before paging kicks in. Keeps the list from
// rendering hundreds of rows at once on heavily-run models.
const PAGE_SIZE = 20;

// The Runs tab (`/models/:modelId/runs`): the full run log for every test case
// this model has been run against (any harness), newest first and paged. The
// model column is dropped since every row is this model. Rows default to recency
// order; the run log's headers re-sort the whole history, which is then paged.
export function ModelRunsPage() {
  return (
    <ModelDetailLayout tab="runs">
      {({ model }) => <RunsContent model={model} />}
    </ModelDetailLayout>
  );
}

function RunsContent({ model }: { model: ModelSummary }) {
  const { runs, localIds, localWriteups } = useRuns();
  const [page, setPage] = useState(0);

  // This model's runs, newest first. A model may cover several ids, so match any
  // of them against the run's subject — canonicalized on both sides so an
  // `openrouter/`-prefixed run lands on the same model as its bare form.
  const modelRuns = useMemo(() => {
    const ids = new Set(model.modelIds.map(canonicalModelId));
    return runs
      .filter((run) => ids.has(canonicalModelId(run.subject.modelId)))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }, [model, runs]);

  // Enrich and sort this model's whole run history before paging, so a header
  // sort orders the full set rather than just the current page.
  const table = useRunTable({
    runs: modelRuns,
    localIds,
    localWriteups,
    scope: "model",
  });

  // Navigating to a different model swaps the whole run set, and re-sorting
  // reshapes it, so jump back to the first page in either case.
  useEffect(() => {
    setPage(0);
  }, [model.slug, table.controls.sort]);

  if (modelRuns.length === 0) {
    return (
      <section className={styles.section}>
        <Panel>
          <p className={styles.empty}>No runs have used {model.name} yet.</p>
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
