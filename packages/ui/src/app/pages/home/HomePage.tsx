import type { RunRecord } from "@test-cabinet/run-record";
import { useMemo, type ReactNode } from "react";
import { Link } from "react-router";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { RatingBadge, canonicalModelId } from "@test-cabinet/ui";
import { RunLog, useRunTable } from "../../components/RunLog";
import { UnpublishedTag } from "../../components/UnpublishedTag";
import { findModelByModelId } from "../../data/models";
import { type Rating, worstRating } from "../../data/ratings";
import { useRuns } from "../../data/useRuns";
import { useFindReview } from "../../data/writeups";
import { useTestCaseName } from "../../data/useTestCaseName";
import { routes } from "../../routes";
import { formatRunTime, formatTokenTotal, formatUsd } from "../../format";
import styles from "./HomePage.module.scss";

// Home: the most recent runs, newest first, framed as the cabinet's "recent
// results". A single featured run leads, the rest follow in the dense,
// column-aligned run log carried over from the gallery. The log defaults to
// recency order, but its headers can be clicked to re-sort by any column.
export function HomePage() {
  const { runs, localIds, localWriteups } = useRuns();
  const findReview = useFindReview();
  const recent = useMemo(() => [...runs].sort(byRecencyDesc), [runs]);
  // The hero spotlights the latest *completed* run: a failed run produced no
  // stats or rating, so featuring it would lead with zeros. Failed runs still
  // appear (mixed in, recency-ordered) in the log below.
  const featured = recent.find((r) => r.status.state === "completed") ?? null;
  const rest = useMemo(
    () => (featured ? recent.filter((r) => r.id !== featured.id) : recent),
    [recent, featured],
  );
  const table = useRunTable({ runs: rest, localIds, localWriteups });
  const featuredRating = featured
    ? (worstRating(
        findReview(featured.id, localWriteups)?.ratings.map((r) => r.rating) ??
          [],
      ) ?? null)
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

        {recent.length === 0 ? (
          <p className={styles.empty}>No runs have been published yet.</p>
        ) : (
          <>
            {featured && (
              <FeaturedRun
                run={featured}
                local={localIds.has(featured.id)}
                rating={featuredRating}
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
function byRecencyDesc(a: RunRecord, b: RunRecord): number {
  return timestamp(b) - timestamp(a);
}

function timestamp(run: RunRecord): number {
  const value = Date.parse(run.finishedAt || run.startedAt);
  return Number.isNaN(value) ? 0 : value;
}

// The lead run: the same vital stats as a log row but given room to breathe,
// with cross-links into the test case and model behind it.
function FeaturedRun({
  run,
  local,
  rating,
}: {
  run: RunRecord;
  local: boolean;
  rating: Rating | null;
}) {
  const { subject, metrics } = run;
  const model = findModelByModelId(subject.modelId);
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
