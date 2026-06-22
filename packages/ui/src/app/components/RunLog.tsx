import type { RunRecord } from "@test-cabinet/run-record";
import { Link } from "react-router";
import { RatingBadge } from "@test-cabinet/ui";
import type { InProgressRun } from "../../client/types";
import { UnpublishedTag } from "./UnpublishedTag";
import { type Rating, worstRating } from "../data/ratings";
import { useFindReview } from "../data/writeups";
import {
  formatSlug,
  formatTokenTotal,
  formatUsd,
} from "../format";
import { routes } from "../routes";
import styles from "./RunLog.module.scss";

/**
 * Which columns the log carries.
 *
 * - `"global"` shows every column for cross-case listings (the home page).
 * - `"variant"` drops the test and variant columns for pages already scoped to
 *   a single test case and variant, where they would be constant.
 * - `"model"` drops the model column for the model detail page, where every row
 *   is the same model; it keeps the test and variant columns.
 */
export type RunLogScope = "global" | "variant" | "model";

interface RunLogProps {
  /** The runs to list, in the order they should appear (the caller sorts). */
  runs: RunRecord[];
  /** Ids of runs sourced from local disk — flagged as unpublished. */
  localIds: ReadonlySet<string>;
  /** Raw local writeups, keyed by run id, used to resolve a run's rating. */
  localWriteups: Readonly<Record<string, string>>;
  /**
   * Runs still executing, rendered as spinner rows pinned above the finished
   * ones (each links to its live monitor instead of a run detail). A run gains no
   * record until it completes, so these can't be ordinary rows; they share the
   * table so the styling matches. Defaults to none.
   */
  active?: InProgressRun[];
  /** Column set to render. Defaults to the full cross-case layout. */
  scope?: RunLogScope;
}

// The dense, column-aligned run log shared by the home gallery and the per-case
// Runs tab. It is not a leaderboard and shows no ranking — rows appear in the
// order the caller passes them (see docs/site.md). Rendering lives here so both
// pages stay pixel-identical; the caller owns sorting, slicing, and paging.
export function RunLog({
  runs,
  localIds,
  localWriteups,
  active = [],
  scope = "global",
}: RunLogProps) {
  // The test/variant columns are constant on a variant-scoped log; the model
  // column is constant on a model-scoped one. Each is dropped where redundant.
  const showCase = scope !== "variant";
  const showModel = scope !== "model";
  const findReview = useFindReview();
  return (
    <div className={styles.log} data-scope={scope}>
      <div className={`${styles.row} ${styles.head}`} aria-hidden="true">
        <span />
        {showCase && <span>TEST</span>}
        <span>HARNESS</span>
        {showCase && <span>VARIANT</span>}
        {showModel && <span>MODEL</span>}
        <span className={styles.num}>TOKENS</span>
        <span className={styles.num}>COST</span>
        <span>RATING</span>
      </div>
      {active.map((run) => (
        <ActiveRow
          key={run.runId}
          run={run}
          showCase={showCase}
          showModel={showModel}
        />
      ))}
      {runs.map((run) => (
        <RunRow
          key={run.id}
          run={run}
          local={localIds.has(run.id)}
          rating={
            worstRating(
              findReview(run.id, localWriteups)?.ratings.map((r) => r.rating) ??
                [],
            ) ?? null
          }
          showCase={showCase}
          showModel={showModel}
        />
      ))}
    </div>
  );
}

// A run still executing, rendered in the same grid as a finished row. The left
// caret gutter holds a spinner instead of the hover chevron; the metric and
// rating cells show placeholders since a run has no record (and so no metrics)
// until it finishes. The whole row links to the live monitor.
function ActiveRow({
  run,
  showCase,
  showModel,
}: {
  run: InProgressRun;
  showCase: boolean;
  showModel: boolean;
}) {
  const failed = run.state === "failed";
  return (
    <Link
      to={routes.runMonitor(run.runId)}
      className={styles.row}
      data-active=""
      data-failed={failed ? "" : undefined}
    >
      <span className={styles.spinner} aria-hidden="true" />
      {showCase && (
        <span className={styles.test}>
          <span className={styles.testName}>{formatSlug(run.testCaseSlug)}</span>
        </span>
      )}
      <span className={styles.harness} data-label="Harness">
        {run.harnessSlug}
      </span>
      {showCase && (
        <span className={styles.variant} data-label="Variant">
          {run.variant}
        </span>
      )}
      {showModel && (
        <span className={styles.model} data-label="Model">
          {run.modelId}
        </span>
      )}
      <span className={`${styles.num} ${styles.noRating}`} data-label="Tokens">
        &mdash;
      </span>
      <span className={`${styles.num} ${styles.noRating}`} data-label="Cost">
        &mdash;
      </span>
      <span className={styles.activeStatus} data-label="Status">
        {failed ? "failed" : "running…"}
      </span>
    </Link>
  );
}

function RunRow({
  run,
  local,
  rating,
  showCase,
  showModel,
}: {
  run: RunRecord;
  local: boolean;
  rating: Rating | null;
  showCase: boolean;
  showModel: boolean;
}) {
  const { subject, metrics } = run;
  // A failed run (execution errored before producing a result) is listed inline
  // so the failure can be inspected, marked with the same negative styling an
  // active row uses. It can carry no rating — it was never reviewable.
  const failed = run.status.state === "failed";
  return (
    <Link
      to={routes.runDetail(run.id)}
      className={styles.row}
      data-failed={failed ? "" : undefined}
    >
      <span className={styles.rowCaret}>&rsaquo;</span>
      {showCase && (
        <span className={styles.test}>
          <span className={styles.testName}>
            {formatSlug(subject.testCaseSlug)}
          </span>
          {local && <UnpublishedTag className={styles.tag} />}
        </span>
      )}
      <span className={styles.harness} data-label="Harness">
        {subject.harnessSlug}
        {/* Without a TEST column to host it, flag unpublished runs here. */}
        {!showCase && local && <UnpublishedTag className={styles.tag} />}
      </span>
      {showCase && (
        <span className={styles.variant} data-label="Variant">
          {subject.variant}
        </span>
      )}
      {showModel && (
        <span className={styles.model} data-label="Model">
          {subject.modelId}
        </span>
      )}
      <span className={styles.num} data-label="Tokens">
        {formatTokenTotal(metrics)}
      </span>
      <span className={styles.num} data-label="Cost">
        {formatUsd(metrics.cost.comparable)}
      </span>
      <span className={styles.rating} data-label="Rating">
        {failed ? (
          <span className={styles.activeStatus}>failed</span>
        ) : rating ? (
          <RatingBadge rating={rating} />
        ) : (
          <span className={styles.noRating}>&mdash;</span>
        )}
      </span>
    </Link>
  );
}
