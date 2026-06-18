import type { RunRecord } from "@test-cabinet/run-record";
import { Link } from "react-router";
import { RatingBadge } from "@test-cabinet/ui";
import { UnpublishedTag } from "./UnpublishedTag";
import type { Rating } from "../data/ratings";
import { useFindReview } from "../data/writeups";
import {
  formatCompact,
  formatSlug,
  formatUsd,
  totalTokens,
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
  scope = "global",
}: RunLogProps) {
  // The test/variant columns are constant on a variant-scoped log; the model
  // column is constant on a model-scoped one. Each is dropped where redundant.
  const showCase = scope !== "variant";
  const showModel = scope !== "model";
  const findReview = useFindReview();
  return (
    <div className={styles.log} data-scope={scope}>
      <div className={`${styles.row} ${styles.head}`}>
        <span />
        {showCase && <span>TEST</span>}
        <span>HARNESS</span>
        {showCase && <span>VARIANT</span>}
        {showModel && <span>MODEL</span>}
        <span className={styles.num}>TOKENS</span>
        <span className={styles.num}>COST</span>
        <span>RATING</span>
      </div>
      {runs.map((run) => (
        <RunRow
          key={run.id}
          run={run}
          local={localIds.has(run.id)}
          rating={findReview(run.id, localWriteups)?.rating ?? null}
          showCase={showCase}
          showModel={showModel}
        />
      ))}
    </div>
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
  return (
    <Link to={routes.runDetail(run.id)} className={styles.row}>
      <span className={styles.rowCaret}>&rsaquo;</span>
      {showCase && (
        <span className={styles.test}>
          {formatSlug(subject.testCaseSlug)}
          {local && <UnpublishedTag className={styles.tag} />}
        </span>
      )}
      <span className={styles.harness}>
        {subject.harnessSlug}
        {/* Without a TEST column to host it, flag unpublished runs here. */}
        {!showCase && local && <UnpublishedTag className={styles.tag} />}
      </span>
      {showCase && <span className={styles.variant}>{subject.variant}</span>}
      {showModel && <span className={styles.model}>{subject.modelId}</span>}
      <span className={styles.num}>{formatCompact(totalTokens(metrics))}</span>
      <span className={styles.num}>{formatUsd(metrics.cost.comparable)}</span>
      <span className={styles.rating}>
        {rating ? (
          <RatingBadge rating={rating} />
        ) : (
          <span className={styles.noRating}>&mdash;</span>
        )}
      </span>
    </Link>
  );
}
