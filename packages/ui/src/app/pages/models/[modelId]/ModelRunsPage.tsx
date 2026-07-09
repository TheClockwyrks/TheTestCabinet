import { useEffect, useMemo, useState } from "react";
import { Pagination, Panel } from "@test-cabinet/ui";
import { RunLog, sortStateToQuery, useRunTable } from "../../../components/RunLog";
import type { ModelSummary } from "../../../data/models";
import { useGalleryData } from "../../../data/galleryContext";
import type { RunQueryResult } from "../../../data/runQuery";
import { ModelDetailLayout } from "../../../layouts/models/ModelDetailLayout";
import styles from "./ModelRunsPage.module.scss";

// How many runs to show per page before paging kicks in. Keeps the list from
// rendering hundreds of rows at once on heavily-run models.
const PAGE_SIZE = 20;

// The Runs tab (`/models/:modelId/runs`): the full run log for this model, newest
// first and paged a page at a time from the server (the console's backend offset
// endpoint, the static site's in-memory index). The model column is dropped since
// every row is this model; a header sort re-queries in that order.
export function ModelRunsPage() {
  return (
    <ModelDetailLayout tab="runs">
      {({ model }) => <RunsContent model={model} />}
    </ModelDetailLayout>
  );
}

function RunsContent({ model }: { model: ModelSummary }) {
  const { producedSummaries, localIds, writeups, queryRunSummaries } =
    useGalleryData();
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<RunQueryResult>({
    summaries: [],
    total: 0,
  });
  const [loading, setLoading] = useState(true);

  // The server filters runs by a single model id, so scope to this model's primary
  // covered id. (A model that covers several ids may under-count runs recorded under
  // a secondary id — the numbered pager can't OR ids server-side; the common
  // single-id model is exact.)
  const modelId = model.modelIds[0] ?? model.slug;

  // Produced (local) runs of this model, pinned to the first page ahead of the
  // queried published window. Matched against the model's covered ids so a local
  // run still lands on its model page.
  const produced = useMemo(() => {
    const covered = new Set(model.modelIds);
    return producedSummaries.filter((run) =>
      covered.has(run.subject.modelId),
    );
  }, [model.modelIds, producedSummaries]);

  const displayed = useMemo(
    () => (page === 0 ? [...produced, ...result.summaries] : result.summaries),
    [page, produced, result.summaries],
  );

  const table = useRunTable({
    runs: displayed,
    localIds,
    localWriteups: writeups,
    scope: "model",
    externalOrder: true,
  });
  const { sort, dir } = sortStateToQuery(table.controls.sort);

  // Fetch one page whenever the model, the active sort, or the page changes.
  useEffect(() => {
    let active = true;
    setLoading(true);
    queryRunSummaries({
      state: "published",
      model: modelId,
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
  }, [queryRunSummaries, modelId, page, sort, dir]);

  // Navigating to a different model swaps the whole run set, and re-sorting
  // reshapes it, so jump back to the first page in either case.
  useEffect(() => {
    setPage(0);
  }, [modelId, sort, dir]);

  const pageCount = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);

  // If the result set shrank under the current page, fall back onto the last real
  // page so the list can't strand on an out-of-range, empty window.
  useEffect(() => {
    if (!loading && page > pageCount - 1) setPage(pageCount - 1);
  }, [loading, page, pageCount]);

  const hasContent = displayed.length > 0;

  if (!hasContent) {
    return (
      <section className={styles.section}>
        <Panel>
          <p className={styles.empty}>
            {loading
              ? `Loading ${model.name} runs…`
              : `No runs have used ${model.name} yet.`}
          </p>
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
