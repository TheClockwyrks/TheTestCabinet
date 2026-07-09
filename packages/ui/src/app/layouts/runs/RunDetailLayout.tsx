import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useParams } from "react-router";
import type { RunRecord } from "@test-cabinet/run-record";
import type { StoredReview } from "../../../client/types";
import { PageLayout } from "../../components/PageLayout";
import { RatingBadge, canonicalModelId } from "@test-cabinet/ui";
import { UnpublishedTag } from "../../components/UnpublishedTag";
import { RunDeleteControl } from "../../components/RunDeleteControl";
import { useGalleryData, type RunDetail } from "../../data/galleryContext";
import { useTestCaseName } from "../../data/useTestCaseName";
import { type ParsedWriteup, parseWriteup, worstRating } from "../../data/ratings";
import { frameReviews } from "../../data/frameReview";
import { describeRunState, hasPlayableOutcome } from "../../data/runState";
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
  /**
   * The tab body, given the resolved run, its framed review (if any), and the raw
   * per-reviewer breakdown fetched with the record — so the Verdict/review/editor
   * tabs read reviews from here rather than the console's global reviews map.
   */
  children: (ctx: {
    run: RunRecord;
    review: ParsedWriteup | undefined;
    reviews: StoredReview[];
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
  const { fetchRun, localIds, writeups: localWriteups, canExecute } =
    useGalleryData();
  const testCaseName = useTestCaseName();

  // A summary-first gallery no longer holds every full record in memory, so the
  // detail chrome resolves just the one run it needs, lazily by id, through the
  // context's `fetchRun` (the consoles read the run store's `GET /runs/{id}`; the
  // static site reads its emitted per-run asset). This also covers a run reached
  // by a direct link that no worklist carries — an infrastructure failure retained
  // for inspection, or a run simply off the current page. `fetchRun` is read
  // through a ref so a fresh gallery-value identity each render can't re-trigger
  // the fetch; the URL `runId` is what selects the record.
  const fetchRunRef = useRef(fetchRun);
  fetchRunRef.current = fetchRun;
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [fetching, setFetching] = useState(true);
  useEffect(() => {
    if (!runId) {
      setDetail(null);
      setFetching(false);
      return;
    }
    let active = true;
    setFetching(true);
    fetchRunRef
      .current(runId)
      .then((resolved) => active && setDetail(resolved))
      .catch(() => active && setDetail(null))
      .finally(() => {
        if (active) setFetching(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  const run = detail?.record ?? null;
  if (!run) {
    return (
      <PageLayout>
        <p className={styles.notFound}>
          {fetching ? "Loading…" : <>No run found for &ldquo;{runId}&rdquo;.</>}
        </p>
      </PageLayout>
    );
  }

  const { subject } = run;
  const isLocal = localIds.has(run.id);
  // The run's per-reviewer breakdown, fetched with the record — the detail layer's
  // source of truth for reviews (the console's global reviews map is no longer
  // read here). Passed to the tab body so the Verdict/review/editor tabs render
  // from it directly.
  const reviews = detail?.reviews ?? [];
  // Frame the run's review from those reviews into the aggregate writeup the
  // header badge and the read-only verdict read. A local run the host carries only
  // a preview writeup for — with no structured reviews (the static site's dev-only
  // previews) — falls back to that raw writeup override.
  const localWriteup = isLocal ? localWriteups[run.id] : undefined;
  const rawReview = localWriteup ?? frameReviews(reviews) ?? undefined;
  const review = rawReview === undefined ? undefined : parseWriteup(rawReview);
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
            {testCaseName(subject.testCaseSlug)}
            {overallRating && <RatingBadge rating={overallRating} />}
            {isLocal && <UnpublishedTag />}
          </h2>
          <span className={styles.harness}>{subject.harnessSlug}</span>
        </div>
        <div className={styles.subjectRow}>
          <span className={styles.subject}>
            {canonicalModelId(subject.modelId)} &middot; test case{" "}
            {subject.testCaseVersion} &middot;{" "}
            <span className={styles.variant}>{subject.variant}</span> variant
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

      {children({ run, review, reviews })}
    </PageLayout>
  );
}
