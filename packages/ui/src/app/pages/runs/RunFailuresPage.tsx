import { useCallback, useEffect, useMemo, useState } from "react";
import type { RunRecord } from "@test-cabinet/run-record";
import type { PublishProgress, StoredRun } from "../../../client/types";
import { Link } from "react-router";
import { Panel, canonicalModelId } from "@test-cabinet/ui";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { useGalleryData } from "../../data/galleryContext";
import { describeRunState } from "../../data/runState";
import { useWorkers } from "../../../client/context";
import { useAuth } from "../../../client/auth";
import { useRunsRuntime } from "../../runtime/runsRuntime";
import { RunsTabs } from "./RunsTabs";
import { useFindModel } from "../../data/useModels";
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
  const { canExecute } = useGalleryData();
  const { active: worker } = useWorkers();
  const { refreshToken, requestRefresh } = useRunsRuntime();
  const { token } = useAuth();
  const client = worker?.client ?? null;

  // The worker's publishable-failures worklist (`listFailures`), which carries
  // pending and already-published failures alike as full stored runs. It is the
  // dedicated source for this page rather than the summary-first gallery list —
  // a failure row shows the run's recorded `status.detail`, which the bounded run
  // summary does not carry — and each run's `published` flag drives its "Published"
  // mark. A transport with no failures worklist simply contributes none.
  const [failures, setFailures] = useState<StoredRun[]>([]);
  useEffect(() => {
    if (!client?.listFailures) {
      setFailures([]);
      return;
    }
    let active = true;
    client
      .listFailures()
      .then((list) => {
        if (active) setFailures(list);
      })
      .catch(() => {
        // A transport that can't enumerate failures contributes none; the page
        // then shows the empty state.
        if (active) setFailures([]);
      });
    return () => {
      active = false;
    };
  }, [client, refreshToken]);

  // The publishable-failure runs, newest first. `listFailures` already scopes to
  // publishable (catastrophic / timed-out) failures, but the state guard keeps an
  // infrastructure failure out defensively.
  const publishable = useMemo(() => {
    return failures
      .filter((f) => describeRunState(f.record.status.state).isPublishableFailure)
      .sort((a, b) => timestamp(b.record) - timestamp(a.record));
  }, [failures]);

  return (
    <PageLayout>
      <PromptHeader
        command="--runs --failures"
        blink
        comment={<>// publishable failures awaiting publish</>}
      />

      <RunsTabs active="failures" />

      {/* The static gallery never reaches this page (the route is console-only),
          but guard anyway so it degrades to an empty state rather than offering
          a publish it cannot perform. */}
      {!canExecute || publishable.length === 0 ? (
        <p className={styles.empty}>
          No publishable failures awaiting publish.
        </p>
      ) : (
        <Panel>
          <ul className={styles.list}>
            {publishable.map(({ record: run, published }) => (
              <FailureRow
                key={run.id}
                run={run}
                published={published}
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
  const model = useFindModel()(subject.modelId, subject.harnessSlug);
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
      await onPublish((progress) =>
        setStatus(`Publishing… ${progress.message}`),
      );
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
          {formatSlug(subject.variant)} ·{" "}
          {model?.name ?? canonicalModelId(subject.modelId)} ·{" "}
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
function timestamp(run: RunRecord): number {
  const value = Date.parse(run.finishedAt || run.startedAt);
  return Number.isNaN(value) ? 0 : value;
}
