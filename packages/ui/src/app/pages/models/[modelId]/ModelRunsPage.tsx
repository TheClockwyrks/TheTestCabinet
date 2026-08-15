import { useEffect, useState } from "react";
import { Pagination, Panel } from "@test-cabinet/ui";
import { LoadingState } from "../../../components/LoadingState";
import { RunLog, sortStateToQuery, useRunTable } from "../../../components/RunLog";
import {
  usePagedSearchParams,
  useResetPageOnChange,
} from "../../../components/usePagedSearchParams";
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
// every row is this model; a header sort re-queries in that order, and an
// unpublished (so unreviewed) run sorts and pages among the published ones rather
// than leading the first page.
export function ModelRunsPage() {
  return (
    <ModelDetailLayout tab="runs">
      {({ model }) => <RunsContent model={model} />}
    </ModelDetailLayout>
  );
}

function RunsContent({ model }: { model: ModelSummary }) {
  const { localIds, writeups, queryRunSummaries } = useGalleryData();
  const { page, setPage } = usePagedSearchParams();
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

  // The table renders the server-ordered page as-is (externalOrder) but still owns
  // the sort state, so its headers drive the re-query below.
  const table = useRunTable({
    runs: result.summaries,
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
      // Every run this host holds for the model — produced ones included, ordered
      // with the published rows rather than ahead of them.
      state: "any",
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
  useResetPageOnChange(setPage, `${modelId}:${sort}:${dir}`);

  const pageCount = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);

  // If the result set shrank under the current page, fall back onto the last real
  // page so the list can't strand on an out-of-range, empty window.
  useEffect(() => {
    if (!loading && page > pageCount - 1) setPage(pageCount - 1, { replace: true });
  }, [loading, page, pageCount, setPage]);

  const hasContent = result.summaries.length > 0;

  if (!hasContent) {
    return (
      <section className={styles.section}>
        <Panel>
          {loading ? (
            <LoadingState
              size="section"
              label={`Loading ${model.name} runs…`}
            />
          ) : (
            <p className={styles.empty}>No runs have used {model.name} yet.</p>
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
