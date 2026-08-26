import { useMemo } from "react";
import type { RunRecord } from "@test-cabinet/run-record";
import { AestheticBadge, RatingBadge } from "@test-cabinet/ui";
import {
  AESTHETIC_META,
  FAILURE_CAP_META,
  RATING_META,
  automatedVerdicts,
  formatPoints,
  isToolchainGated,
  validatorDomainRatings,
  validatorRating,
  validatorScore,
  worstAestheticRating,
  type AestheticRating,
  type DomainAesthetic,
  type Rating,
} from "../../../data/ratings";
import type { ReviewModel } from "../../../data/galleryContext";
import { DebugScriptList } from "./DebugScriptList";
import { ReviewChecklist } from "./ReviewChecklist";
import { validatorFailures } from "./autoVerdicts";
import styles from "./RunDetailPages.module.scss";

/**
 * Everything the validators decided about a **validator-rated** run, computed
 * from its record against the case version's effective scoring model — available
 * the moment the run completes, independent of any review. The one place the
 * console derives these figures, so the Verdict tab and the review editor never
 * disagree.
 */
export interface ValidatorDecision {
  /** The functional rating: the worst across `domainRatings`, composed with the
   * toolchain gate. Always present — zero failures is Flawless. */
  rating: Rating | null;
  /** The validator-decided score (automated-only, toolchain-gated). */
  score: { earned: number; total: number };
  /** Each effective domain's functional rating, in domain order. */
  domainRatings: Map<string, Rating>;
  /** The failing scored points and the caps they imposed. */
  failures: ReturnType<typeof validatorFailures>;
  /** Whether the toolchain gate held the run at Broken / zero points. */
  gated: boolean;
}

/**
 * Decide a validator-rated run from its record and scoring model (see
 * {@link ValidatorDecision}). Mirrors `validator_rating` / `validator_score` in
 * the Rust core, which is what the store lifts onto the run — so what this shows
 * on completion is exactly what the backend records.
 */
export function decideValidatorRun(
  run: RunRecord,
  model: ReviewModel,
): ValidatorDecision {
  const debugScripts = run.validation.debugScripts ?? [];
  const gated = isToolchainGated(run.toolchain);
  const domainRatings = validatorDomainRatings(
    model.domains,
    model.items,
    debugScripts,
  );
  return {
    rating: validatorRating(gated, domainRatings),
    score: validatorScore(gated, model.items, debugScripts),
    domainRatings: new Map(domainRatings.map((r) => [r.domain, r.rating])),
    failures: validatorFailures(model.items, debugScripts),
    gated,
  };
}

/**
 * The read-only verdict of a validator-rated run: the functional badge beside the
 * aesthetic one (when any reviewer has rated it), the validator-decided points,
 * a per-domain breakdown that lists the failing items that capped each domain,
 * and the machine-decided checklist — read-only, with each assertion's detail in
 * the automated-validation list. (The media behind each verdict is browsed per
 * item in the ReviewItemBrowser the verdict surfaces mount beside this.) No
 * override exists on such a run, so nothing here is a control.
 *
 * `aesthetics` is the aggregate per-domain aesthetic rating (worst across
 * reviewers) to show beside each domain; empty until someone reviews the run.
 * `showOverall` (default) leads with the two badges and the score; the
 * single-review page omits it.
 */
export function ValidatorVerdict({
  run,
  model,
  aesthetics,
  showOverall = true,
  showChecklist = true,
}: {
  run: RunRecord;
  model: ReviewModel;
  aesthetics: readonly DomainAesthetic[];
  showOverall?: boolean;
  showChecklist?: boolean;
}) {
  const decision = useMemo(() => decideValidatorRun(run, model), [run, model]);
  const debugScripts = run.validation.debugScripts ?? [];
  const aestheticByDomain = new Map(
    aesthetics.map((a) => [a.domain, a.rating]),
  );
  const overallAesthetic: AestheticRating | null = worstAestheticRating(
    aesthetics.map((a) => a.rating),
  );
  const { rating, score, failures } = decision;

  return (
    <>
      {showOverall && (
        <div className={styles.verdictHeader}>
          <p className={styles.verdict}>
            {/* The two channels side by side: the validator-decided functional
                rating, then the reviewer-decided aesthetic one once it exists. */}
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
        Decided by this run&rsquo;s validators: every scored point was checked
        by its script, and each failing point caps the domains it affects at its
        failure cap. Reviewers rate only the aesthetic channel
        {overallAesthetic
          ? ` — ${AESTHETIC_META[overallAesthetic].label.toLowerCase()} here, the worst any reviewer gave any domain.`
          : "; no reviewer has rated it yet."}
      </p>

      {model.domains.length > 0 && (
        <div className={styles.domains}>
          <h2 className={styles.checklistHeading}>Domains</h2>
          <ul className={styles.domainList}>
            {model.domains.map((domain) => {
              const domainRating = decision.domainRatings.get(domain.id);
              const aesthetic = aestheticByDomain.get(domain.id);
              const capped = failures.filter((f) =>
                f.domains.includes(domain.id),
              );
              return (
                <li key={domain.id} className={styles.domainRow}>
                  <div className={styles.domainHead}>
                    <span
                      className={styles.domainName}
                      title={domain.description}
                    >
                      {domain.name}
                    </span>
                    <span className={styles.badgePair}>
                      {domainRating && <RatingBadge rating={domainRating} />}
                      {aesthetic && <AestheticBadge rating={aesthetic} />}
                    </span>
                  </div>
                  {/* The failing items that lowered this domain, each with the
                      cap it imposed; the domain sits at the lowest of them. */}
                  {capped.length > 0 && (
                    <ul className={styles.capList} aria-label="Capped by">
                      {capped.map((failure) => (
                        <li key={failure.id} className={styles.capRow}>
                          <span className={styles.capPoint}>
                            {failure.category && (
                              <span className={styles.capCategory}>
                                {failure.category} ›{" "}
                              </span>
                            )}
                            {failure.title}
                          </span>
                          <span
                            className={styles.capTier}
                            data-cap={failure.cap}
                            title={FAILURE_CAP_META[failure.cap].description}
                          >
                            <span aria-hidden="true">→ </span>
                            {FAILURE_CAP_META[failure.cap].label}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {showChecklist && (
        <>
          {/* The machine-decided checklist, read-only: exactly the verdicts the
              validators produced (the same failure semantics the rating uses). */}
          {model.items.length > 0 && (
            <ReviewChecklist
              model={model}
              verdicts={automatedVerdicts(debugScripts)}
            />
          )}
          {/* The scripts behind those verdicts: which ran, and each assertion's
              detail. (The media each output captured is browsed per item in the
              ReviewItemBrowser the verdict surfaces mount beside this.) Public
              on a validator-rated run — there is no reviewer call for it to
              bias. */}
          {debugScripts.length > 0 && (
            <div className={styles.checklist}>
              <DebugScriptList
                scripts={debugScripts}
                heading="Automated validation"
                collapsible
              />
            </div>
          )}
        </>
      )}
    </>
  );
}
