import { useCallback, useEffect, useMemo, useState } from "react";
import type { RunRecord } from "@test-cabinet/run-record";
import type { PublishProgress } from "../../../client/types";
import { Link } from "react-router";
import { Panel } from "@test-cabinet/ui";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { useGalleryData } from "../../data/galleryContext";
import { describeRunState } from "../../data/runState";
import { useRuns } from "../../data/useRuns";
import { useWorkers } from "../../../client/context";
import { useAuth } from "../../../client/auth";
import { useRunsRuntime } from "../../runtime/runsRuntime";
import { findModelByModelId } from "../../data/models";
import { formatSlug } from "../../format";
import { useTestCaseName } from "../../data/useTestCaseName";
import { routes } from "../../routes";
import styles from "./RunFailuresPage.module.scss";
import exec from "./RunExec.module.scss";

// The Publish-failures worklist (`/runs/failures`, consoles only): the produced
// catastrophic / timed-out runs the console holds locally. Unlike a completed
// run these carry no review checklist — a publishable failure is real model
// signal that publishes without a review — so they never appear in the review
// flow and would otherwise be invisible until published. Each row shows the
// run's identity, its failure tier, and the recorded failure detail, with a
// Publish button that clears the publish gate. Infrastructure failures are the
// Test Cabinet's own fault and are never publishable, so they are excluded.
export function RunFailuresPage() {
  const { runs, localIds } = useRuns();
  const { canExecute } = useGalleryData();
  const { active: worker } = useWorkers();
  const { refreshToken, requestRefresh } = useRunsRuntime();
  const { token } = useAuth();
  const client = worker?.client ?? null;

  // The already-published failure ids, fetched from the worker's failures
  // worklist (which carries pending and published alike). Used only to mark a
  // row as already published and disable its button; the list itself is driven
  // off the gallery runs below. A transport with no failures worklist simply
  // leaves this empty.
  const [publishedIds, setPublishedIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  useEffect(() => {
    if (!client?.listFailures) return;
    let active = true;
    client
      .listFailures()
      .then((failures) => {
        if (!active) return;
        setPublishedIds(
          new Set(failures.filter((f) => f.published).map((f) => f.id)),
        );
      })
      .catch(() => {
        // A transport that can't enumerate failures contributes no published
        // marks; the rows still render and publish.
      });
    return () => {
      active = false;
    };
  }, [client, refreshToken]);

  // The local publishable-failure runs: produced (local) catastrophic /
  // timed-out runs, newest first.
  const failures = useMemo(() => {
    return runs
      .filter(
        (run) =>
          localIds.has(run.id) &&
          describeRunState(run.status.state).isPublishableFailure,
      )
      .sort(byRecencyDesc);
  }, [runs, localIds]);

  return (
    <PageLayout>
      <div className={exec.runsHeader}>
        <PromptHeader
          command="--runs --failures"
          blink
          comment={<>// publishable failures awaiting publish</>}
        />
        <Link className={exec.secondary} to={routes.runs()}>
          ← All runs
        </Link>
      </div>

      {/* The static gallery never reaches this page (the route is console-only),
          but guard anyway so it degrades to an empty state rather than offering
          a publish it cannot perform. */}
      {!canExecute || failures.length === 0 ? (
        <p className={styles.empty}>No publishable failures awaiting publish.</p>
      ) : (
        <Panel>
          <ul className={styles.list}>
            {failures.map((run) => (
              <FailureRow
                key={run.id}
                run={run}
                published={publishedIds.has(run.id)}
                token={token}
                onPublish={
                  client
                    ? (onProgress) => client.publish(run.id, token!, onProgress)
                    : null
                }
                onPublished={requestRefresh}
              />
            ))}
          </ul>
        </Panel>
      )}
    </PageLayout>
  );
}

// One failure row: the run's case / variant / model / harness identity, its
// failure-tier chip and recorded detail, and the Publish control. Publishing
// needs a signed-in account (the backend authorizes the call with its token);
// when signed out the row links to sign-in instead. After a successful publish
// it nudges the data source to re-read so the row reflects its published state.
function FailureRow({
  run,
  published,
  token,
  onPublish,
  onPublished,
}: {
  run: RunRecord;
  published: boolean;
  token: string | null;
  onPublish:
    | ((onProgress: (progress: PublishProgress) => void) => Promise<unknown>)
    | null;
  onPublished: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { subject } = run;
  const presentation = describeRunState(run.status.state);
  const model = findModelByModelId(subject.modelId);
  const testCaseName = useTestCaseName();

  // Publishing is asynchronous: enqueue and observe the release over its live
  // stream, surfacing each progress line, and only let the row settle into
  // "Published" (via the parent re-read) once the stream reports success.
  const publish = useCallback(async () => {
    if (!onPublish || !token) return;
    setBusy(true);
    setError(null);
    setStatus("Publishing…");
    try {
      await onPublish((progress) => setStatus(`Publishing… ${progress.message}`));
      onPublished();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }, [onPublish, token, onPublished]);

  return (
    <li className={styles.row}>
      <div className={styles.identity}>
        <Link className={styles.test} to={routes.runDetail(run.id)}>
          {testCaseName(subject.testCaseSlug)}
        </Link>
        <span className={styles.meta}>
          {formatSlug(subject.variant)} · {model?.name ?? subject.modelId} ·{" "}
          {subject.harnessSlug}
        </span>
        {run.status.detail && (
          <p className={styles.detail}>{run.status.detail}</p>
        )}
        {status && <p className={styles.detail}>{status}</p>}
        {error && <p className={styles.error}>{error}</p>}
      </div>
      <div className={styles.controls}>
        <span className={styles.chip} data-state={run.status.state}>
          {presentation.chip}
        </span>
        {published ? (
          <span className={styles.publishedTag}>Published</span>
        ) : token ? (
          <button
            type="button"
            className={exec.primary}
            onClick={publish}
            disabled={busy || !onPublish}
            title={
              onPublish
                ? "Publish this failure as a model result"
                : "Connect the worker that produced this run to publish it"
            }
          >
            Publish
          </button>
        ) : (
          <Link
            className={exec.secondary}
            to={routes.login(routes.runFailures())}
          >
            Sign in to publish
          </Link>
        )}
      </div>
    </li>
  );
}

// Newest first, by finish time, falling back to start time when a run never
// recorded a finish. Matches the all-runs index.
function byRecencyDesc(a: RunRecord, b: RunRecord): number {
  return timestamp(b) - timestamp(a);
}

function timestamp(run: RunRecord): number {
  const value = Date.parse(run.finishedAt || run.startedAt);
  return Number.isNaN(value) ? 0 : value;
}
