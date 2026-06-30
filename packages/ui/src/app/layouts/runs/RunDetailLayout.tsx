import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useParams } from "react-router";
import type { RunRecord } from "@test-cabinet/run-record";
import { PageLayout } from "../../components/PageLayout";
import { RatingBadge } from "@test-cabinet/ui";
import { UnpublishedTag } from "../../components/UnpublishedTag";
import { RunDeleteControl } from "../../components/RunDeleteControl";
import { useGalleryData } from "../../data/galleryContext";
import { type ParsedWriteup, worstRating } from "../../data/ratings";
import { describeRunState, hasPlayableOutcome } from "../../data/runState";
import { useRuns } from "../../data/useRuns";
import { useFindReview } from "../../data/writeups";
import { routes } from "../../routes";
import styles from "./RunDetailLayout.module.scss";

// The run detail page's tabs. Each is a distinct route; this drives which tab
// link reads as active.
export type RunDetailTab =
  | "verdict"
  | "play"
  | "inputs"
  | "proof"
  | "metrics"
  | "events"
  | "metadata";

interface RunDetailLayoutProps {
  /** Which tab the rendering page represents. */
  tab: RunDetailTab;
  /**
   * Lay the page body out as a full-height column so a filling tab body (the
   * Events tab's feed) can grow into the space below the tabs.
   */
  fill?: boolean;
  /** The tab body, given the resolved run and its review (if any). */
  children: (ctx: {
    run: RunRecord;
    review: ParsedWriteup | undefined;
  }) => ReactNode;
}

// Shared chrome for every run detail tab: the test case / harness title row, the
// subject line with the harness version pushed to the right, and the tab
// navigation. It resolves the run from the URL id and its hand-written review,
// then hands both to the active tab's body. Resolving (and the not-found state)
// lives here so the tab pages stay thin and never duplicate it.
export function RunDetailLayout({
  tab,
  fill = false,
  children,
}: RunDetailLayoutProps) {
  const { runId } = useParams<{ runId: string }>();
  const { runs, localIds, localWriteups, loading } = useRuns();
  const { readRun, canExecute } = useGalleryData();
  const findReview = useFindReview();
  const listed = runId
    ? runs.find((candidate) => candidate.id === runId)
    : undefined;

  // A run reached by a direct link — the live monitor's "open the failed run"
  // link is the common case — may not be in the loaded list: an infrastructure
  // failure is retained for inspection but appears in no worklist, and a run can
  // simply be off the current page. Fall back to fetching it by id so any
  // persisted run stays openable, not only listed ones.
  const [fetched, setFetched] = useState<RunRecord | null>(null);
  const [fetching, setFetching] = useState(false);
  useEffect(() => {
    if (listed || !runId || !readRun || loading) {
      setFetched(null);
      setFetching(false);
      return;
    }
    let active = true;
    setFetching(true);
    readRun(runId)
      .then((record) => active && setFetched(record))
      .catch(() => active && setFetched(null))
      .finally(() => {
        if (active) setFetching(false);
      });
    return () => {
      active = false;
    };
  }, [listed, runId, readRun, loading]);

  const run = listed ?? fetched ?? undefined;

  if (!run) {
    return (
      <PageLayout>
        <p className={styles.notFound}>
          {loading || fetching ? (
            "Loading…"
          ) : (
            <>No run found for &ldquo;{runId}&rdquo;.</>
          )}
        </p>
      </PageLayout>
    );
  }

  const { subject } = run;
  const isLocal = localIds.has(run.id);
  const review = findReview(run.id, localWriteups);
  // The headline badge shows the run's overall rating — the worst across its
  // per-domain ratings.
  const overallRating = review
    ? worstRating(review.ratings.map((r) => r.rating))
    : null;

  // Neither an asset-generation run (a static asset) nor an adversarial run (a
  // match replay) produces a hostable playable build, so neither has a Play tab:
  // an asset run shows its result on the Verdict tab, an adversarial run shows its
  // proof matches (the replays) on the Proof tab. A failed run (catastrophic,
  // timed-out, or infrastructure) never produced a build to host either, so it has
  // no Play tab regardless of type.
  const hasPlayableBuild =
    hasPlayableOutcome(run.status.state) &&
    run.subject.testType !== "asset-generation" &&
    run.subject.testType !== "adversarial";
  const tabs: { key: RunDetailTab; label: string; to: string }[] = [
    { key: "verdict", label: "Verdict", to: routes.runDetail(run.id) },
    ...(hasPlayableBuild
      ? [{ key: "play" as const, label: "Play", to: routes.runPlay(run.id) }]
      : []),
    { key: "inputs", label: "Inputs", to: routes.runInputs(run.id) },
    { key: "proof", label: "Proof", to: routes.runProof(run.id) },
    { key: "metrics", label: "Metrics", to: routes.runMetrics(run.id) },
    { key: "events", label: "Events", to: routes.runEvents(run.id) },
    { key: "metadata", label: "Metadata", to: routes.runMetadata(run.id) },
  ];

  return (
    <PageLayout fill={fill}>
      {/* Two rows spanning the content width: the test case title against the
          harness slug, then the subject line against the harness version. */}
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h2 className={styles.title}>
            {subject.testCaseSlug}
            {overallRating && <RatingBadge rating={overallRating} />}
            {isLocal && <UnpublishedTag />}
          </h2>
          <span className={styles.harness}>{subject.harnessSlug}</span>
        </div>
        <div className={styles.subjectRow}>
          <span className={styles.subject}>
            {subject.modelId} &middot; test case {subject.testCaseVersion}{" "}
            &middot; <span className={styles.variant}>{subject.variant}</span>{" "}
            variant
          </span>
          {subject.harnessVersion && (
            <span className={styles.harnessVersion}>
              harness v{subject.harnessVersion}
            </span>
          )}
        </div>
      </header>

      {(() => {
        const presentation = describeRunState(run.status.state);
        if (!presentation.isFailure) return null;
        return (
          <div
            className={styles.failureBanner}
            data-state={run.status.state}
            role="alert"
          >
            <span className={styles.failureTitle}>{presentation.label}</span>
            <span className={styles.failureDetail}>
              {run.status.detail ?? presentation.description}
            </span>
          </div>
        );
      })()}

      <div className={styles.controls}>
        <nav className={styles.tabs} aria-label="Run sections">
          {tabs.map((entry) => (
            <NavLink
              key={entry.key}
              to={entry.to}
              className={
                entry.key === tab
                  ? `${styles.tab} ${styles.tabActive}`
                  : styles.tab
              }
            >
              {entry.label}
            </NavLink>
          ))}
        </nav>
        {/* Deleting is offered only for an unpublished run the active worker
            produced; the control renders nothing otherwise (a published run, the
            public gallery). It is mounted only where the host can execute runs,
            since it reads the worker context the static site does not provide
            (mirroring how GalleryApp gates the worker-reading NotificationsLayer)
            — without this gate `useWorkers` throws and blanks the run page. */}
        {canExecute && <RunDeleteControl runId={run.id} />}
      </div>

      {children({ run, review })}
    </PageLayout>
  );
}
