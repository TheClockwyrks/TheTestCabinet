import type { RunRecord } from "@test-cabinet/run-record";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { PageLayout } from "../../components/PageLayout";
import { RatingBadge } from "../../components/RatingBadge";
import { UnpublishedTag } from "../../components/UnpublishedTag";
import { findModelByModelId } from "../../data/models";
import type { Rating } from "../../data/ratings";
import { useRuns } from "../../data/useRuns";
import { findReview } from "../../data/writeups";
import { routes } from "../../routes";
import {
  formatCompact,
  formatRunTime,
  formatSlug,
  formatUsd,
  totalTokens,
} from "../../format";
import styles from "./HomePage.module.scss";

// Home: the most recent runs, newest first, framed as the cabinet's "recent
// results". A single featured run leads, the rest follow in the dense,
// column-aligned run log carried over from the gallery. It is not a
// leaderboard and shows no ranking — runs are ordered purely by recency.
export function HomePage() {
  const { runs, localIds, localWriteups } = useRuns();
  const recent = [...runs].sort(byRecencyDesc);
  const featured = recent[0];
  const rest = recent.slice(1);
  const ratingOf = (run: RunRecord): Rating | null =>
    findReview(run.id, localWriteups)?.rating ?? null;

  return (
    <PageLayout>
      <section className={styles.terminal}>
        <header className={styles.hero}>
          <p className={styles.prompt}>
            <span className={styles.caret}>&gt;</span> the-test-cabinet --recent
            <span className={styles.blink}>_</span>
          </p>
          <p className={styles.comment}>
            // insert coin &middot; consume tokens &middot; play the
            result
          </p>
        </header>

        {!featured ? (
          <p className={styles.empty}>No runs have been published yet.</p>
        ) : (
          <>
            <FeaturedRun
              run={featured}
              local={localIds.has(featured.id)}
              rating={ratingOf(featured)}
            />
            {rest.length > 0 && (
              <div className={styles.log}>
                <div className={`${styles.row} ${styles.head}`}>
                  <span />
                  <span>TEST</span>
                  <span>HARNESS</span>
                  <span>VARIANT</span>
                  <span>MODEL</span>
                  <span className={styles.num}>TOKENS</span>
                  <span className={styles.num}>COST</span>
                  <span>RATING</span>
                </div>
                {rest.map((run) => (
                  <RunRow
                    key={run.id}
                    run={run}
                    local={localIds.has(run.id)}
                    rating={ratingOf(run)}
                  />
                ))}
              </div>
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
  return (
    <article className={styles.feature}>
      <p className={styles.featureLabel}>
        <span className={styles.caret}>&rsaquo;</span> latest result
      </p>
      <h2 className={styles.featureTest}>
        <Link to={routes.testCaseDetail(subject.testCaseSlug)}>
          {formatSlug(subject.testCaseSlug)}
        </Link>
        {local && <UnpublishedTag className={styles.tag} />}
      </h2>
      <p className={styles.featureSubject}>
        <span className={styles.featureHarness}>{subject.harnessSlug}</span>
        <span className={styles.featureSep}>&middot;</span>
        <span className={styles.featureVariant}>{subject.variant}</span>
        <span className={styles.featureSep}>&middot;</span>
        {model ? (
          <Link to={routes.modelDetail(model.slug)} className={styles.featureModel}>
            {model.name}
          </Link>
        ) : (
          <span className={styles.featureModel}>{subject.modelId}</span>
        )}
      </p>

      <dl className={styles.stats}>
        <Stat label="Tokens" value={formatCompact(totalTokens(metrics))} />
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

function Stat({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className={styles.stat}>
      <dt className={styles.statLabel}>{label}</dt>
      <dd className={styles.statValue}>{value}</dd>
    </div>
  );
}

function RunRow({
  run,
  local,
  rating,
}: {
  run: RunRecord;
  local: boolean;
  rating: Rating | null;
}) {
  const { subject, metrics } = run;
  return (
    <Link to={routes.runDetail(run.id)} className={styles.row}>
      <span className={styles.rowCaret}>&rsaquo;</span>
      <span className={styles.test}>
        {formatSlug(subject.testCaseSlug)}
        {local && <UnpublishedTag className={styles.tag} />}
      </span>
      <span>{subject.harnessSlug}</span>
      <span className={styles.variant}>{subject.variant}</span>
      <span className={styles.model}>{subject.modelId}</span>
      <span className={styles.num}>{formatCompact(totalTokens(metrics))}</span>
      <span className={styles.num}>{formatUsd(metrics.cost.comparable)}</span>
      <span className={styles.rating}>
        {rating ? (
          <RatingBadge rating={rating} />
        ) : (
          <span className={styles.noRating}>—</span>
        )}
      </span>
    </Link>
  );
}
