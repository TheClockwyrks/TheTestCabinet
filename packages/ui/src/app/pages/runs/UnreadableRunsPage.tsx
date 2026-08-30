import { useCallback, useEffect, useState } from "react";
import { Pagination, Panel } from "@test-cabinet/ui";
import type { UnreadableRun } from "../../../client/types";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { useConfirm } from "../../components/ConfirmDialog";
import { usePagedSearchParams } from "../../components/usePagedSearchParams";
import { useGalleryData } from "../../data/galleryContext";
import { CONFIRM_DELETE_RUN, useRunDeletion } from "../../data/useRunDeletion";
import { useOptionalWorkers } from "../../../client/context";
import { useRunsRuntime } from "../../runtime/runsRuntime";
import { RunsTabs } from "./RunsTabs";
import { StopRunsControls, useCanStopRuns } from "./StopRunsControls";
import { formatSlug } from "../../format";
import styles from "./UnreadableRunsPage.module.scss";
import exec from "./RunExec.module.scss";

// How many rows to show per page — matches the other runs worklists.
const PAGE_SIZE = 20;

// The Unreadable worklist (`/runs/unreadable`, consoles only): the stored runs
// whose records this backend build can no longer decode. Every other listing counts
// and serves only the runs it can read, so these appear nowhere else and their
// detail pages answer 404 — without this page they occupy the store while being
// reachable from nothing but the database.
//
// A row is deliberately not a run summary card: there is no readable record to
// build one from. It shows the identity the backend lifted into columns, the error
// the record produces now, and a Delete control, which is the only action that
// makes sense here.
export function UnreadableRunsPage() {
  const { canExecute } = useGalleryData();
  const { refreshToken } = useRunsRuntime();
  const canStop = useCanStopRuns();
  const client = useOptionalWorkers()?.active?.client ?? null;
  const { page, setPage } = usePagedSearchParams();

  const [runs, setRuns] = useState<UnreadableRun[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!client?.listUnreadableRuns) {
      setRuns([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    client
      .listUnreadableRuns({ limit: PAGE_SIZE, offset: page * PAGE_SIZE })
      .then((result) => {
        if (!active) return;
        setRuns(result.runs);
        setTotal(result.total);
        setLoading(false);
      })
      .catch(() => {
        // A transport that cannot enumerate these contributes none; the page then
        // shows its empty state.
        if (!active) return;
        setRuns([]);
        setTotal(0);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, page, refreshToken]);

  // The backend's `total` counts exactly the rows this listing can serve, so a page
  // this sizes is a page that holds rows.
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);

  // Deleting the last row of the open page shrinks the set under it, so fall back
  // onto the last real page rather than stranding on an empty window.
  useEffect(() => {
    if (!loading && page > pageCount - 1)
      setPage(pageCount - 1, { replace: true });
  }, [loading, page, pageCount, setPage]);

  return (
    <PageLayout>
      <PromptHeader
        command="--runs --unreadable"
        blink
        comment={<>// stored runs this build cannot decode</>}
        actions={canStop ? <StopRunsControls /> : undefined}
      />

      <RunsTabs active="unreadable" />

      {!canExecute || runs.length === 0 ? (
        <p className={styles.empty}>No unreadable runs are stored.</p>
      ) : (
        <>
          <Panel>
            <ul className={styles.list}>
              {runs.map((run) => (
                <UnreadableRow key={run.id} run={run} />
              ))}
            </ul>
          </Panel>
          <Pagination
            page={current}
            pageCount={pageCount}
            onPageChange={setPage}
          />
        </>
      )}
    </PageLayout>
  );
}

// One unreadable run: its lifted identity, when it finished, the decode error, and
// the Delete control. The control is gated on the host rather than on the produced
// worklist, which never holds one of these rows, and a published row carries it too:
// an unreadable run is already out of the snapshot and the gallery, so the backend
// deletes it either way and this page is the only place it can be got rid of.
function UnreadableRow({ run }: { run: UnreadableRun }) {
  const { canDeleteUnreadable, deleteRun } = useRunDeletion();
  const { confirm } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDelete = useCallback(async () => {
    if (!(await confirm(CONFIRM_DELETE_RUN))) return;
    setBusy(true);
    setError(null);
    try {
      // `deleteRun` nudges the runs runtime, which re-reads this page's listing, so
      // the row leaves the list without any local bookkeeping.
      await deleteRun(run.id);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }, [confirm, deleteRun, run.id]);

  return (
    <li className={styles.row}>
      <div className={styles.identity}>
        {/* Not a link: the run's detail page answers 404 for exactly the reason
            this row exists. */}
        <span className={styles.test}>{formatSlug(run.testCaseSlug)}</span>
        <span className={styles.meta}>
          {formatSlug(run.variant)} · {run.testCaseVersion} · {run.modelId} ·{" "}
          {run.harnessSlug}
        </span>
        <span className={styles.meta}>
          {run.id} · {run.finishedAt}
        </span>
        <p className={styles.detail}>{run.error}</p>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>
      <div className={styles.controls}>
        {run.published && (
          <span className={styles.publishedTag}>Published</span>
        )}
        {canDeleteUnreadable() && (
          <button
            type="button"
            className={exec.secondary}
            onClick={onDelete}
            disabled={busy}
            title="Permanently delete this run"
          >
            {busy ? "Deleting…" : "Delete"}
          </button>
        )}
      </div>
    </li>
  );
}
