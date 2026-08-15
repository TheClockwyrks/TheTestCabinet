import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { ReviewerWidgets } from "./ReviewerWidgets";
import { useAuth } from "../../../client/auth";
import { GradeBadge, RatingBadge, canonicalModelId } from "@test-cabinet/ui";
import { LoadingState } from "../../components/LoadingState";
import { RunLog, useRunTable } from "../../components/RunLog";
import { UnpublishedTag } from "../../components/UnpublishedTag";
import { useFindModel } from "../../data/useModels";
import {
  asGrade,
  overallGradeOf,
  type GradeStatus,
  type Rating,
  worstRating,
} from "../../data/ratings";
import { useGalleryData } from "../../data/galleryContext";
import { useFindReview } from "../../data/writeups";
import { useTestCaseName } from "../../data/useTestCaseName";
import { routes } from "../../routes";
import { formatRunTime, formatTokenTotal, formatUsd } from "../../format";
import styles from "./HomePage.module.scss";

// How many recent runs the home page shows: the featured run plus a page of the
// log below it. Fetched in one recent-first query, not the whole cabinet.
const RECENT_LIMIT = 20;

// Home: the most recent runs, newest first, framed as the cabinet's "recent
// results". A single featured run leads, the rest follow in the dense,
// column-aligned run log carried over from the gallery. The recent set is one
// server query (newest first); the log's headers can still be clicked to re-sort
// the shown page, driven by the table's own sort state.
export function HomePage() {
  const {
    canExecute,
    localIds,
    writeups: localWriteups,
    queryRunSummaries,
  } = useGalleryData();
  const { token } = useAuth();
  const findReview = useFindReview();
  const [recentRuns, setRecentRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);

  // The most recent runs, newest first — a single page-0 query rather than the
  // whole cabinet. The consoles draw from the union slice so a produced (still
  // unpublished) run takes its place in that recent window by date, exactly as it
  // does in the runs index; the public gallery holds only published runs.
  useEffect(() => {
    let active = true;
    setLoading(true);
    queryRunSummaries({
      state: "any",
      sort: "date",
      dir: "desc",
      offset: 0,
      limit: RECENT_LIMIT,
    })
      .then((res) => {
        if (!active) return;
        setRecentRuns(res.summaries);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setRecentRuns([]);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [queryRunSummaries]);

  // The queried window is already the newest runs of whichever slice this host
  // draws from; re-sort defensively so the hero and the log agree on "latest".
  const recent = useMemo(
    () => [...recentRuns].sort(byRecencyDesc),
    [recentRuns],
  );
  // The hero spotlights the latest *completed* run: a failed run produced no
  // stats or rating, so featuring it would lead with zeros. Failed runs still
  // appear (mixed in, recency-ordered) in the log below.
  const featured = recent.find((r) => r.state === "completed") ?? null;
  const rest = useMemo(
    () => (featured ? recent.filter((r) => r.id !== featured.id) : recent),
    [recent, featured],
  );
  // The recent set is small and already fetched whole, so let the table sort it
  // client-side: the log's column headers stay live (the featured hero is still
  // the latest completed run, resolved by recency independently below), and the
  // fetch itself is a fixed date-desc "recent" window.
  const table = useRunTable({ runs: rest, localIds, localWriteups });
  // A local, unpublished writeup wins the featured rating (an in-progress edit
  // must show before it is published); absent one, the summary's own aggregate
  // rating stands in.
  const featuredReview = featured
    ? findReview(featured.id, localWriteups)
    : undefined;
  const featuredRating = featured
    ? (worstRating(featuredReview?.ratings.map((r) => r.rating) ?? []) ??
      featured.rating)
    : null;
  // A game jam carries no per-domain rating: its badge is the reviewer's
  // whole-game overall grade, resolved the same way (a local, in-progress review
  // first, then the summary card's aggregate) so the hero shows a jam's verdict
  // rather than a bare dash.
  const featuredGrade = featured
    ? ((featuredReview && overallGradeOf(featuredReview.checklist)) ??
      asGrade(featured.score?.overallGrade))
    : null;

  return (
    <PageLayout>
      <section className={styles.terminal}>
        <PromptHeader
          command="--recent"
          blink
          comment={
            <>// insert coin &middot; consume tokens &middot; play the result</>
          }
        />

        {/* Reviewer dashboard: at-a-glance coverage + unreviewed count. Console
            only, and only for a signed-in reviewer (the plan is per-account). */}
        {canExecute && token && <ReviewerWidgets />}

        {recent.length === 0 ? (
          loading ? (
            <LoadingState label="Loading runs…" />
          ) : (
            <p className={styles.empty}>No runs have been published yet.</p>
          )
        ) : (
          <>
            {featured && (
              <FeaturedRun
                run={featured}
                // Unpublished per the console's produced worklist OR per the card
                // itself (a queried run carries no publish timestamp until it is
                // published), mirroring the run log's own tag.
                local={localIds.has(featured.id) || !featured.publishedAt}
                rating={featuredRating}
                grade={featuredGrade}
              />
            )}
            {rest.length > 0 && (
              <RunLog rows={table.rows} controls={table.controls} />
            )}
          </>
        )}
      </section>
    </PageLayout>
  );
}

// Newest first, by finish time, falling back to start time when a run never
// recorded a finish (e.g. it failed before completing).
function byRecencyDesc(a: RunSummary, b: RunSummary): number {
  return timestamp(b) - timestamp(a);
}

function timestamp(run: RunSummary): number {
  const value = Date.parse(run.finishedAt || run.startedAt);
  return Number.isNaN(value) ? 0 : value;
}

// The lead run: the same vital stats as a log row but given room to breathe,
// with cross-links into the test case and model behind it.
function FeaturedRun({
  run,
  local,
  rating,
  grade,
}: {
  run: RunSummary;
  local: boolean;
  rating: Rating | null;
  /** A game jam's whole-game overall grade, shown in place of the rating a jam
   * does not carry. Null for every domain-rated run. */
  grade: GradeStatus | null;
}) {
  const { subject, metrics } = run;
  const model = useFindModel()(subject.modelId, subject.harnessSlug);
  const testCaseName = useTestCaseName();
  return (
    <article className={styles.feature}>
      <p className={styles.featureLabel}>
        <span className={styles.caret}>&rsaquo;</span> latest result
      </p>
      <h2 className={styles.featureTest}>
        <Link to={routes.testCaseDetail(subject.testCaseSlug)}>
          {testCaseName(subject.testCaseSlug)}
        </Link>
        {local && <UnpublishedTag className={styles.tag} />}
      </h2>
      <p className={styles.featureSubject}>
        <span className={styles.featureHarness}>{subject.harnessSlug}</span>
        <span className={styles.featureSep}>&middot;</span>
        <span className={styles.featureVariant}>{subject.variant}</span>
        <span className={styles.featureSep}>&middot;</span>
        {model ? (
          <Link
            to={routes.modelDetail(model.slug)}
            className={styles.featureModel}
          >
            {model.name}
          </Link>
        ) : (
          <span className={styles.featureModel}>
            {canonicalModelId(subject.modelId)}
          </span>
        )}
      </p>

      <dl className={styles.stats}>
        <Stat label="Tokens" value={formatTokenTotal(metrics)} />
        <Stat label="Cost" value={formatUsd(metrics.cost.comparable)} />
        <Stat label="Time" value={formatRunTime(metrics.runTimeSeconds)} />
        <Stat
          label="Rating"
          value={
            rating ? (
              <RatingBadge rating={rating} />
            ) : grade ? (
              <GradeBadge status={grade} />
            ) : (
              <span className={styles.noRating}>—</span>
            )
          }
        />
      </dl>

      <Link to={routes.runDetail(run.id)} className={styles.featureCta}>
        open run &rsaquo;
      </Link>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className={styles.stat}>
      <dt className={styles.statLabel}>{label}</dt>
      <dd className={styles.statValue}>{value}</dd>
    </div>
  );
}
