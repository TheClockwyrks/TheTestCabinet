import { useMemo } from "react";
import type { RunRecord } from "@clockwyrks/run-record";
import { AestheticBadge, RatingBadge } from "@clockwyrks/ui";
import {
  AESTHETIC_META,
  RATING_META,
  aggregateAestheticRating,
  automatedVerdicts,
  effectiveVerdicts,
  formatPoints,
  isToolchainGated,
  reviewAesthetic,
  validatorAggregateRating,
  validatorAggregateScore,
  verdictDomainRatings,
  worstRating,
  type AestheticRating,
  type DomainAesthetic,
  type Rating,
  type ReviewVerdict,
} from "../../../data/ratings";
import type { ReviewModel } from "../../../data/galleryContext";
import styles from "./RunDetailPages.module.scss";

/**
 * The minimal review shape the verdict folds in: the reviewer's verdict
 * overrides (`checklist`) and their run-wide aesthetic tier (`aesthetic`, with
 * the legacy per-domain `aesthetics` kept readable via `reviewAesthetic`).
 * `StoredReview` satisfies it.
 */
export interface ValidatorReviewInput {
  /** The reviewer's overrides: one binary verdict per overridden point. */
  checklist?: readonly ReviewVerdict[];
  /** The reviewer's run-wide aesthetic tier, when they rated one. */
  aesthetic?: AestheticRating | null;
  /** LEGACY per-domain tiers (old stored rows); collapsed to their worst. */
  aesthetics?: readonly DomainAesthetic[];
}

/**
 * Everything decided about a **validator-rated** run: the validators' verdicts
 * from its record, with any reviews' overrides folded in — available the moment
 * the run completes (zero reviews reproduce the validators' own figures
 * exactly). The one place the console derives these figures, so the Verdict tab
 * and the review editor never disagree.
 */
export interface ValidatorDecision {
  /** The functional rating: with no reviews the validators' own; with reviews
   * the worst across the reviews' effective ratings. Always present — zero
   * failures is Flawless. */
  rating: Rating | null;
  /** The score: the validators' own with no reviews, else the average of the
   * reviews' effective scores (toolchain-gated either way). */
  score: { earned: number; total: number };
  /** Each effective domain's functional rating, overrides folded in (worst
   * across reviews), in domain order. */
  domainRatings: Map<string, Rating>;
  /** Whether the toolchain gate held the run at Broken / zero points. */
  gated: boolean;
}

/**
 * Decide a validator-rated run from its record, its scoring model, and its
 * reviews' overrides (see {@link ValidatorDecision}). Mirrors
 * `validator_aggregate_rating` / `validator_aggregate_score` in the Rust core,
 * which is what the store lifts onto the run — so what this shows is exactly
 * what the backend records. With no reviews it reproduces `validator_rating` /
 * `validator_score` unchanged.
 */
export function decideValidatorRun(
  run: RunRecord,
  model: ReviewModel,
  reviews: readonly ValidatorReviewInput[] = [],
): ValidatorDecision {
  const debugScripts = run.validation.debugScripts ?? [];
  const gated = isToolchainGated(run.toolchain);
  const auto = automatedVerdicts(debugScripts);
  const overrides = reviews.map((r) => r.checklist ?? []);
  // The effective per-domain ratings: the validators' own with no reviews;
  // otherwise, per domain, the worst across the reviews' effective checklists —
  // the same worst-wins fold `validatorAggregateRating` takes over the whole run.
  const verdictSets =
    overrides.length === 0
      ? [auto]
      : overrides.map((o) => effectiveVerdicts(auto, o));
  const domainRatings = new Map<string, Rating>();
  for (const verdicts of verdictSets) {
    for (const r of verdictDomainRatings(model.domains, model.items, verdicts)) {
      const current = domainRatings.get(r.domain);
      domainRatings.set(
        r.domain,
        current ? (worstRating([current, r.rating]) ?? r.rating) : r.rating,
      );
    }
  }
  return {
    rating: validatorAggregateRating(
      gated,
      model.domains,
      model.items,
      auto,
      overrides,
    ),
    score: validatorAggregateScore(gated, model.items, auto, overrides),
    domainRatings,
    gated,
  };
}

/**
 * The verdict header of a validator-rated run: the functional badge beside the
 * aesthetic one (once any reviewer has rated it), the points, and a compact
 * per-domain strip of effective functional ratings — overrides folded in. The
 * per-item detail (each point's verdict, media, assertions, failure cap, and
 * backing script) lives in the ReviewItemBrowser the verdict surfaces mount
 * beside this, so nothing is rendered twice.
 *
 * `reviews` are the run's reviews: their checklists are the reviewers' verdict
 * overrides and their run-wide tiers aggregate into the aesthetic badge.
 * `showOverall` (default) leads with the two badges and the score.
 */
export function ValidatorVerdict({
  run,
  model,
  reviews = [],
  showOverall = true,
}: {
  run: RunRecord;
  model: ReviewModel;
  reviews?: readonly ValidatorReviewInput[];
  showOverall?: boolean;
}) {
  const decision = useMemo(
    () => decideValidatorRun(run, model, reviews),
    [run, model, reviews],
  );
  const overallAesthetic: AestheticRating | null = aggregateAestheticRating(
    reviews.map((review) => reviewAesthetic(review)),
  );
  const { rating, score } = decision;

  return (
    <>
      {showOverall && (
        <div className={styles.verdictHeader}>
          <p className={styles.verdict}>
            {/* The two channels side by side: the effective functional rating
                (the validators', with any reviewer overrides folded in), then
                the reviewer-decided aesthetic one once it exists. */}
            <span className={styles.badgePair}>
              {rating && <RatingBadge rating={rating} />}
              {overallAesthetic && <AestheticBadge rating={overallAesthetic} />}
            </span>
            <span className={styles.verdictLabel}>
              {rating
                ? decision.gated
                  ? "Held at Broken: the toolchain typecheck failed, so the build does not compile."
                  : RATING_META[rating].description
                : ""}
            </span>
          </p>
          <p className={styles.score}>
            <span className={styles.scoreValue}>
              {formatPoints(score.earned)} / {score.total}
            </span>{" "}
            <span className={styles.scoreUnit}>pts</span>
          </p>
        </div>
      )}
      <p className={styles.validatorNote}>
        The verdicts are this run&rsquo;s validators&rsquo;: every scored point
        was checked by its script, and each failing point caps the domains it
        affects at its failure cap. A reviewer can override any point&rsquo;s
        verdict — the rating and score fold those overrides in — and reviewers
        also rate the run&rsquo;s aesthetics
        {overallAesthetic
          ? `: ${AESTHETIC_META[overallAesthetic].label.toLowerCase()} here, the worst any reviewer gave.`
          : "; no reviewer has rated it yet."}
      </p>

      {model.domains.length > 0 && (
        <div className={styles.domains}>
          <h2 className={styles.checklistHeading}>Domains</h2>
          <ul className={styles.domainList}>
            {model.domains.map((domain) => {
              const domainRating = decision.domainRatings.get(domain.id);
              return (
                <li key={domain.id} className={styles.domainRow}>
                  <div className={styles.domainHead}>
                    <span
                      className={styles.domainName}
                      title={domain.description}
                    >
                      {domain.name}
                    </span>
                    {domainRating && <RatingBadge rating={domainRating} />}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}
