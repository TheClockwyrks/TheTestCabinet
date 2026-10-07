import { useCallback, useEffect, useState } from "react";
import { Pagination, Panel } from "@clockwyrks/ui";
import type { UnreadableRun } from "../../../client/types";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { useConfirm } from "../../components/ConfirmDialog";
import { usePagedSearchParams } from "../../components/usePagedSearchParams";
import { LoadFailureState } from "../../components/LoadFailureState";
import { LoadingState } from "../../components/LoadingState";
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

  // Whether this host can enumerate the listing at all: the static gallery mounts
  // no worker, and a worker whose transport predates the route serves no such
  // listing. Distinct from "the listing is empty" — the page can say nothing at
  // all about a cabinet it cannot read.
  const supported = canExecute && Boolean(client?.listUnreadableRuns);

  const [runs, setRuns] = useState<UnreadableRun[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  // The read's own failure, so an unreachable backend is never reported as a
  // cabinet that stores no unreadable runs.
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    if (!supported || !client?.listUnreadableRuns) {
      setRuns([]);
      setTotal(0);
      setFailure(null);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setFailure(null);
    client
      .listUnreadableRuns({ limit: PAGE_SIZE, offset: page * PAGE_SIZE })
      .then((result) => {
        if (!active) return;
        setRuns(result.runs);
        setTotal(result.total);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        // A read that failed says nothing about what the cabinet holds. The rows
        // are dropped (they are this page's stale answer to a question that has
        // no answer right now) and the failure is reported in their place.
        if (!active) return;
        setRuns([]);
        setTotal(0);
        setFailure(String(cause));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [supported, client, page, refreshToken]);

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

      {/* Four outcomes, four states. This page used to collapse all four into
          "No unreadable runs are stored." — a read still in flight, a host that
          cannot ask, a read that failed, and a cabinet that genuinely holds none
          all told the operator the same (and, for three of them, false) thing. */}
      {!supported ? (
        <p className={styles.empty}>
          The unreadable worklist is served by a connected worker. It isn&apos;t
          part of the static gallery.
        </p>
      ) : loading ? (
        <LoadingState label="Loading unreadable runs…" />
      ) : failure ? (
        <LoadFailureState subject="the unreadable worklist" detail={failure} />
      ) : runs.length === 0 ? (
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
// the Delete control. The control is gated on the host (and on being signed in,
// which disables rather than hides it) rather than on the produced
// worklist, which never holds one of these rows, and a published row carries it too:
// an unreadable run is already out of the snapshot and the gallery, so the backend
// deletes it either way and this page is the only place it can be got rid of.
function UnreadableRow({ run }: { run: UnreadableRun }) {
  const { unreadableGate, deleteRun } = useRunDeletion();
  const gate = unreadableGate();
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
        {/* Hidden only where this host can delete no run at all; a console with
            nobody signed in shows it disabled with the reason, since signing in
            is a step the operator takes from this very page. */}
        {gate.offered && (
          <button
            type="button"
            className={exec.secondary}
            onClick={onDelete}
            disabled={busy || !gate.allowed}
            title={gate.reason ?? "Permanently delete this run"}
          >
            {busy ? "Deleting…" : "Delete"}
          </button>
        )}
      </div>
    </li>
  );
}
