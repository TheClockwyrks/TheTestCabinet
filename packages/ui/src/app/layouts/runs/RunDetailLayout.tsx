import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useParams } from "react-router";
import type { RunRecord } from "@test-cabinet/run-record";
import type { StoredReview } from "../../../client/types";
import { PageLayout } from "../../components/PageLayout";
import { LoadingState } from "../../components/LoadingState";
import { BackChevron } from "../../components/BackChevron";
import { DownloadIcon } from "../../components/DownloadIcon";
import { ExternalLinkIcon } from "../../components/ExternalLinkIcon";
import { GradeBadge, RatingBadge, canonicalModelId } from "@test-cabinet/ui";
import { UnpublishedTag } from "../../components/UnpublishedTag";
import { RunDeleteControl } from "../../components/RunDeleteControl";
import { useGalleryData, type RunDetail } from "../../data/galleryContext";
import { grafanaTraceUrl } from "../../data/grafanaTraceUrl";
import { useTestCaseName } from "../../data/useTestCaseName";
import { useFindModel } from "../../data/useModels";
import {
  overallGradeOf,
  type ParsedWriteup,
  parseWriteup,
  worstRating,
} from "../../data/ratings";
import { frameReviews } from "../../data/frameReview";
import { describeRunState, hasPlayableOutcome } from "../../data/runState";
import { routes } from "../../routes";
import styles from "./RunDetailLayout.module.scss";

// The run detail page's tabs. Each is a distinct route; this drives which tab
// link reads as active. The `verdict` key names the run's default tab, which
// reads as "Verdict" for a human-reviewed run and "Results" for a
// results-scored run (a performance run scored on fuel, an adversarial run on
// its match records) — one route, two labels.
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
   * The tab body, given the resolved run, its framed review (if any), the raw
   * per-reviewer breakdown fetched with the record — so the Verdict/review/editor
   * tabs read reviews from here rather than the console's global reviews map —
   * and whether the run is already published (the review editor offers no Publish
   * action once it is).
   */
  children: (ctx: {
    run: RunRecord;
    review: ParsedWriteup | undefined;
    reviews: StoredReview[];
    published: boolean;
  }) => ReactNode;
}

// A process-wide cache of resolved run details, keyed by run id. Each tab is a
// distinct route, so switching tabs re-mounts this layout and would otherwise
// re-fetch the record and blank the whole header + tab strip until it returned.
// Seeding from this cache lets a run already viewed this session render its
// chrome immediately on a tab switch (the background fetch still refreshes it),
// so the title and tabs stay stable across every tab — only a run never fetched
// this session shows the full-body loading state, and only on its first view.
const runDetailCache = new Map<string, RunDetail>();

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
  const {
    fetchRun,
    localIds,
    writeups: localWriteups,
    canExecute,
    grafanaUrl,
    runArchiveUrl,
  } = useGalleryData();
  const testCaseName = useTestCaseName();
  const findModel = useFindModel();

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
  // Seed from the session cache so a run already viewed renders its chrome on the
  // first frame of a tab switch, with no blank while the refresh fetch runs.
  const [detail, setDetail] = useState<RunDetail | null>(() =>
    runId ? (runDetailCache.get(runId) ?? null) : null,
  );
  const [fetching, setFetching] = useState(true);
  useEffect(() => {
    if (!runId) {
      setDetail(null);
      setFetching(false);
      return;
    }
    let active = true;
    // Reset to whatever the cache holds for this id: the record itself on a tab
    // switch (chrome stays put), or null on a fresh run (the full-body loading
    // state shows until the fetch lands). Either way the fetch below refreshes it.
    setDetail(runDetailCache.get(runId) ?? null);
    setFetching(true);
    fetchRunRef
      .current(runId)
      .then((resolved) => {
        if (resolved) runDetailCache.set(runId, resolved);
        if (active) setDetail(resolved);
      })
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
        {fetching ? (
          // A full-body branded loading state (the topbar stays), centred rather
          // than a small spinner stranded in the corner. "No run found" is shown
          // only once the fetch settles with no record.
          <LoadingState label="Loading run…" />
        ) : (
          <p className={styles.notFound}>
            No run found for &ldquo;{runId}&rdquo;.
          </p>
        )}
      </PageLayout>
    );
  }

  const { subject } = run;
  // Resolve the run's opaque model id to its catalog entry so the subject line
  // can link to the model page. `routes.modelDetail` keys on the model's slug,
  // and an id with no catalog match falls back to the plain canonical id text.
  const model = findModel(subject.modelId, subject.harnessSlug);
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
  // A performance run is scored automatically — correctness gated, then fuel —
  // and carries no human review, so its default tab is the auto-scored Results
  // tab rather than a reviewer's Verdict.
  const isPerformance = subject.testType === "performance";
  // An adversarial run is assessed on its match results alone — the record of
  // every reference opponent (baseline and evaluation algorithm) its controller
  // was replayed against — and carries no reviewer verdict or checklist, so it
  // too leads with a Results tab rather than a Verdict.
  const isAdversarial = subject.testType === "adversarial";
  // A run graded on results alone — a performance run (fuel) or an adversarial
  // run (matches) — has no reviewer verdict; the two share the auto-scored
  // Results tab and skip every review affordance.
  const isResultsScored = isPerformance || isAdversarial;
  // The headline badge shows the run's overall rating — the worst across its
  // per-domain ratings. A results-scored run has no reviewer rating to show, so
  // it shows no badge.
  const overallRating =
    review && !isResultsScored
      ? worstRating(review.ratings.map((r) => r.rating))
      : null;
  // A game jam declares no scoring domains, so it has no rating to be worst
  // across: the reviewer's whole-game overall grade is its headline badge
  // instead. It rides the aggregate review's checklist under the reserved
  // `overall` id, and reads as null for every domain-rated run (a pass/fail
  // verdict is not a grade).
  const overallGrade =
    review && !isResultsScored ? overallGradeOf(review.checklist) : null;

  // None of an asset-generation run (a static asset), an adversarial run (a match
  // replay), or a performance run (a wasm engine scored on fuel) produces a
  // hostable playable build, so none has a Play tab: an asset run shows its result
  // on the Verdict tab, while a performance run and an adversarial run each show
  // their result on the Results tab (fuel scores and match records respectively).
  // A run that never produced a build to host (catastrophic, timed-out, or
  // infrastructure) likewise has no Play tab regardless of type
  // (`hasPlayableOutcome` is the single gate for that distinction).
  const hasPlayableBuild =
    hasPlayableOutcome(run.status.state) &&
    run.subject.testType !== "asset-generation" &&
    run.subject.testType !== "adversarial" &&
    !isPerformance;
  // The Proof tab is only meaningful when there is proof to show, so a case (or
  // game jam) that requests none hides it entirely rather than showing an empty
  // "requests no proof" page. What counts is the proof-of-implementation media a
  // case declares (empty `validation.proofs` when it declares none). Neither
  // results-scored type offers the tab: an adversarial run's match replays are its
  // result, shown per opponent on the Results tab, so they are never counted here;
  // a performance run's factory playback likewise lives on the Results tab,
  // launched per scored scenario from that scenario's row, and a performance case
  // declares no media of its own — so neither has anything left to prove on a
  // separate tab.
  const hasProof = !isAdversarial && run.validation.proofs.length > 0;
  const tabs: { key: RunDetailTab; label: string; to: string }[] = [
    {
      key: "verdict",
      label: isResultsScored ? "Results" : "Verdict",
      to: routes.runDetail(run.id),
    },
    ...(hasPlayableBuild
      ? [{ key: "play" as const, label: "Play", to: routes.runPlay(run.id) }]
      : []),
    { key: "inputs", label: "Inputs", to: routes.runInputs(run.id) },
    ...(hasProof
      ? [{ key: "proof" as const, label: "Proof", to: routes.runProof(run.id) }]
      : []),
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
            <BackChevron to={routes.runs()} section="runs" label="All runs" />
            <Link
              className={styles.titleLink}
              to={routes.testCaseDetail(subject.testCaseSlug)}
            >
              {testCaseName(subject.testCaseSlug)}
            </Link>
            {overallRating ? (
              <RatingBadge rating={overallRating} />
            ) : (
              overallGrade && <GradeBadge status={overallGrade} />
            )}
            {isLocal && <UnpublishedTag />}
          </h2>
          <span className={styles.harness}>{subject.harnessSlug}</span>
        </div>
        <div className={styles.subjectRow}>
          <span className={styles.subject}>
            {model ? (
              <Link
                className={styles.modelLink}
                to={routes.modelDetail(model.slug)}
              >
                {model.name}
              </Link>
            ) : (
              canonicalModelId(subject.modelId)
            )}{" "}
            &middot; test case {subject.testCaseVersion} &middot;{" "}
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
        {/* The trailing action controls, grouped into one right-aligned,
            vertically-centered cluster. Wrapping them means a single
            `margin-left: auto` on the group claims the gap after the tabs — where
            previously each control declared its own `margin-left: auto` and, being
            separate flex items, each absorbed an equal share of the free space and
            spread them far apart. Inside the group they sit together at the normal
            control gap. */}
        <div className={styles.controlActions}>
          {/* Deleting is offered only for an unpublished run the active worker
            produced; the control renders nothing otherwise (a published run, the
            public gallery). It is mounted only where the host can execute runs,
            since it reads the worker context the static site does not provide
            (mirroring how GalleryApp gates the worker-reading NotificationsLayer)
            — without this gate `useWorkers` throws and blanks the run page. */}
          {/* Download the run's whole produced tree — source, build, media, and logs
            — as one gzip tar from the artifact service. Gated on `canExecute`: this
            is an internal affordance for the consoles (web + Tauri), not something
            the public gallery offers, and the static site supplies no resolver
            anyway. A run whose tree the host cannot serve resolves to null and the
            link is simply absent.

            A plain anchor rather than a fetch-and-blob download (the pattern the
            GIF export uses): the archive is the whole run and runs to tens of
            megabytes, so the browser should stream it to disk rather than buffer it
            in the page. The filename comes from the response's `Content-Disposition`
            — the artifact service is a different origin, where the anchor's own
            `download` attribute is ignored. */}
          {(() => {
            if (!canExecute) return null;
            const archiveUrl = runArchiveUrl?.(run.id) ?? null;
            if (!archiveUrl) return null;
            return (
              <a
                className={styles.downloadLink}
                href={archiveUrl}
                aria-label="Download run archive"
                title="Download this run's produced tree (source, build, media, and logs) as a single .tar.gz"
              >
                <DownloadIcon className={styles.controlIcon} />
              </a>
            );
          })()}
          {/* Link out to the traces this run emitted, when the deployment runs an
            observability stack. Rendered from the record's own timestamps so
            Explore opens on the window the run actually occupied. Not gated on
            `canExecute`: reading a run's traces is an inspection affordance, and
            the gate that matters is whether a Grafana exists to link to — the
            static site reports none. */}
          {(() => {
            const tracesUrl = grafanaTraceUrl(grafanaUrl, run.id, run);
            if (!tracesUrl) return null;
            return (
              <a
                className={styles.tracesLink}
                href={tracesUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="View run traces"
                title="Search Grafana for the traces this run emitted"
              >
                <ExternalLinkIcon className={styles.controlIcon} />
              </a>
            );
          })()}
          {canExecute && <RunDeleteControl runId={run.id} />}
        </div>
      </div>

      {children({ run, review, reviews, published: detail?.published ?? false })}
    </PageLayout>
  );
}
