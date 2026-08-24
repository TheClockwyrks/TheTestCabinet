// The token, cost and error widgets shared by the overview surfaces of a gg run: the
// whole-run Dashboard, a profile's row in the Agents section, and — scoped to one
// instance — that instance's Overview file in the Instances explorer. Keeping them here
// — one Tokens widget, one Cost widget, one Errors widget, one generic two-segment ring,
// one error ranking — is what makes an agent's overview read as the same dashboard,
// narrowed to that agent, rather than a different-looking panel.
//
// The Tokens widget shows the run's input and output totals (input = cached +
// uncached, output = reasoning + output) and absorbs the two composition rings
// (how much input was cached, how much output was reasoning). The Cost widget shows
// the total cost, its per-class split, and an input-vs-output cost ring; the split is
// derived from catalog prices (see ggCost.ts), since a recorded cost is one figure per
// accounting rather than a class-by-class breakdown. gg attributes every accounting to
// the model that spent it, so the split holds for a run spanning any number of models —
// and, on the whole-run Dashboard, so does the same widget's account of *where* the money
// went: bars per agent profile (each naming the model bound to it) and per model.
//
// The Errors widget is the same tally the Dashboard's error row states, folded into one
// card: an instance's own errored turns, its worst streak, and its ranked types. The
// Dashboard keeps its three-tile row — it has a bento row to spend on the run's error
// record and the ranking wants the width — but both surfaces rank through
// {@link ErrorTypeRanking} and phrase the rate through {@link errorRatePhrase}, so what
// "37% of 19 turns" or a missing per-type split means cannot come to differ between them.
// The one reading this card carries that the Dashboard's row does not is the scope's
// failed CALLS ({@link CallFailureRanking}): a failure class summed over every agent of a
// run names no agent, and the reading worth having is "this instance spent forty calls on
// the same `not-found`".

import {
  callFailureSurface,
  shortTokens,
  topCallFailures,
  topErrorTypes,
  TURN_ERROR_LABELS,
  type ContextSnapshot,
  type GgErrorTally,
  type GgRankedError,
  type UsageTally,
} from "./useGgRunState";
import type { GgCostBreakdown, GgSpendBreakdown, SpendRow } from "./ggCost";
import styles from "./GgDashboard.module.scss";

const numberFmt = new Intl.NumberFormat("en-US");
export function formatTokens(n: number): string {
  return numberFmt.format(n);
}
export function formatCost(n: number | null): string {
  return n == null ? "—" : `$${n.toFixed(4)}`;
}
// A share as a whole percent, with a `<1%` floor so a rare-but-present slice never
// rounds away to nothing and an exact `0%` when the class is truly empty.
export function formatPercent(fraction: number): string {
  const pct = fraction * 100;
  if (pct === 0) return "0%";
  if (pct < 1) return "<1%";
  return `${Math.round(pct)}%`;
}

// The container class for a Tokens/Cost card: the bordered `.card` tile, or the
// chrome-less `.cardBare` when the host already frames the content, with any
// host-supplied grid class appended.
function cardClass(bare: boolean, className?: string): string {
  const base = (bare ? styles.cardBare : styles.card) ?? "";
  return className ? `${base} ${className}` : base;
}

// SVG geometry for a two-segment ring: a 120-unit box with a 46-unit radius leaves
// room for the 14-unit stroke; arcs are drawn from 12 o'clock by rotating -90°.
const RING_BOX = 120;
const RING_CENTER = RING_BOX / 2;
const RING_RADIUS = 46;
const RING_STROKE = 14;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;

interface RingSegment {
  label: string;
  value: number;
}

/**
 * A labeled two-segment ring: a gauge whose primary arc is the interesting share
 * (cached input / reasoning output / input's share of cost) and whose legend gives
 * both segments' raw figures and shares. `formatValue` renders those figures — token
 * counts on the Tokens widget, dollars on the Cost widget — so one ring serves both.
 * Empty (no value of either class yet) reads as a note.
 */
export function SplitRing({
  label,
  primary,
  secondary,
  total,
  emptyMessage,
  formatValue = formatTokens,
  className,
}: {
  label: string;
  primary: RingSegment;
  secondary: RingSegment;
  total: number;
  emptyMessage: string;
  formatValue?: (n: number) => string;
  /** Extra classes on the ring group — e.g. the Cost widget's top-spacing step. */
  className?: string;
}) {
  const primaryFraction = total > 0 ? primary.value / total : 0;
  const secondaryFraction = total > 0 ? secondary.value / total : 0;
  const primaryDash = primaryFraction * RING_CIRC;
  // The secondary arc starts where the primary ends (clockwise from 12 o'clock).
  const secondaryOffset = -primaryFraction * RING_CIRC;
  const secondaryDash = secondaryFraction * RING_CIRC;

  return (
    <div
      className={
        className ? `${styles.ringGroup} ${className}` : styles.ringGroup
      }
    >
      <span className={styles.ringGroupLabel}>{label}</span>
      {total === 0 ? (
        <p className={styles.ringEmpty}>{emptyMessage}</p>
      ) : (
        <div className={styles.ringBody}>
          <svg
            className={styles.ring}
            viewBox={`0 0 ${RING_BOX} ${RING_BOX}`}
            role="img"
            aria-label={`${label}: ${formatPercent(primaryFraction)} ${
              primary.label
            } (${formatValue(primary.value)}), ${formatPercent(
              secondaryFraction,
            )} ${secondary.label} (${formatValue(secondary.value)})`}
          >
            <circle
              className={styles.ringTrack}
              cx={RING_CENTER}
              cy={RING_CENTER}
              r={RING_RADIUS}
              strokeWidth={RING_STROKE}
            />
            {secondaryDash > 0 && (
              <circle
                className={styles.ringArcSecondary}
                cx={RING_CENTER}
                cy={RING_CENTER}
                r={RING_RADIUS}
                strokeWidth={RING_STROKE}
                strokeDasharray={`${secondaryDash} ${RING_CIRC - secondaryDash}`}
                strokeDashoffset={secondaryOffset}
                transform={`rotate(-90 ${RING_CENTER} ${RING_CENTER})`}
              />
            )}
            {primaryDash > 0 && (
              <circle
                className={styles.ringArcPrimary}
                cx={RING_CENTER}
                cy={RING_CENTER}
                r={RING_RADIUS}
                strokeWidth={RING_STROKE}
                strokeDasharray={`${primaryDash} ${RING_CIRC - primaryDash}`}
                strokeDashoffset={0}
                transform={`rotate(-90 ${RING_CENTER} ${RING_CENTER})`}
              />
            )}
            <text
              className={styles.ringCenterValue}
              x={RING_CENTER}
              y={RING_CENTER}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {formatPercent(primaryFraction)}
            </text>
            <text
              className={styles.ringCenterLabel}
              x={RING_CENTER}
              y={RING_CENTER + 18}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {primary.label}
            </text>
          </svg>
          <ul className={styles.ringLegend}>
            <RingLegendRow
              variant="primary"
              label={primary.label}
              value={primary.value}
              fraction={primaryFraction}
              formatValue={formatValue}
            />
            <RingLegendRow
              variant="secondary"
              label={secondary.label}
              value={secondary.value}
              fraction={secondaryFraction}
              formatValue={formatValue}
            />
          </ul>
        </div>
      )}
    </div>
  );
}

function RingLegendRow({
  variant,
  label,
  value,
  fraction,
  formatValue,
}: {
  variant: "primary" | "secondary";
  label: string;
  value: number;
  fraction: number;
  formatValue: (n: number) => string;
}) {
  return (
    <li className={styles.legendItem}>
      <span
        className={
          variant === "primary"
            ? styles.legendSwatchPrimary
            : styles.legendSwatchSecondary
        }
      />
      <span className={styles.legendLabel}>{label}</span>
      <span className={styles.legendValue}>
        {formatValue(value)} · {formatPercent(fraction)}
      </span>
    </li>
  );
}

/**
 * The context-fullness gauge for an agent's Overview: how full its window is — the
 * signal compaction acts on — as a ring, so it reads in the same visual language as
 * the Tokens and Cost widgets' composition rings rather than as a lone linear bar.
 * A single-value gauge (used vs the window limit), not a two-segment split, so it
 * keeps the `meter` role that a fullness read-out warrants; its primary arc is the
 * used share and its center the fullness percent, with the raw used/free figures in
 * the legend. When the run reported no window limit there is no fraction to plot, so
 * it falls back to the raw total. Renders nothing until a breakdown snapshot arrives.
 */
export function ContextUsageRing({
  latest,
  label = "Context window",
}: {
  latest: ContextSnapshot | null;
  /**
   * The gauge's caption. Defaults to "Context window" — the agent's current
   * fullness; the Overview also renders a second ring fed the peak snapshot under
   * a "Peak context window" label.
   */
  label?: string;
}) {
  if (!latest) return null;
  const limit = latest.windowLimit ?? null;
  // The reported fullness, or total/limit when only the raw figures are present.
  const fullness =
    latest.fullness != null
      ? latest.fullness
      : limit
        ? latest.totalTokens / limit
        : null;
  const used = latest.totalTokens;
  const free = limit != null ? Math.max(limit - used, 0) : null;
  // The arc never overdraws past a full circle even if a snapshot reports >100%.
  const shownFraction =
    fullness != null ? Math.min(Math.max(fullness, 0), 1) : 0;
  const usedDash = shownFraction * RING_CIRC;

  return (
    <div className={styles.ringGroup}>
      <span className={styles.ringGroupLabel}>{label}</span>
      {fullness != null ? (
        <div className={styles.ringBody}>
          <svg
            className={styles.ring}
            viewBox={`0 0 ${RING_BOX} ${RING_BOX}`}
            role="meter"
            aria-label={`${label} fullness`}
            aria-valuenow={Math.round(fullness * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <circle
              className={styles.ringTrack}
              cx={RING_CENTER}
              cy={RING_CENTER}
              r={RING_RADIUS}
              strokeWidth={RING_STROKE}
            />
            {usedDash > 0 && (
              <circle
                className={styles.ringArcPrimary}
                cx={RING_CENTER}
                cy={RING_CENTER}
                r={RING_RADIUS}
                strokeWidth={RING_STROKE}
                strokeDasharray={`${usedDash} ${RING_CIRC - usedDash}`}
                strokeDashoffset={0}
                transform={`rotate(-90 ${RING_CENTER} ${RING_CENTER})`}
              />
            )}
            <text
              className={styles.ringCenterValue}
              x={RING_CENTER}
              y={RING_CENTER}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {formatPercent(fullness)}
            </text>
            <text
              className={styles.ringCenterLabel}
              x={RING_CENTER}
              y={RING_CENTER + 18}
              textAnchor="middle"
              dominantBaseline="central"
            >
              full
            </text>
          </svg>
          <ul className={styles.ringLegend}>
            <li className={styles.legendItem}>
              <span className={styles.legendSwatchPrimary} />
              <span className={styles.legendLabel}>used</span>
              <span className={styles.legendValue}>
                {formatTokens(used)} · {formatPercent(fullness)}
              </span>
            </li>
            {free != null && (
              <li className={styles.legendItem}>
                <span className={styles.legendSwatchSecondary} />
                <span className={styles.legendLabel}>free</span>
                <span className={styles.legendValue}>
                  {formatTokens(free)} · {formatPercent(1 - shownFraction)}
                </span>
              </li>
            )}
          </ul>
        </div>
      ) : (
        // No window limit reported: there is no fraction to plot, so the raw total
        // stands in for the gauge.
        <div className={styles.ringNoLimit}>
          <span className={styles.metricValue}>{formatTokens(used)}</span>
          <span className={styles.metricUnit}>tokens · turn {latest.turn}</span>
        </div>
      )}
    </div>
  );
}

/**
 * The Tokens widget: the scope's input and output totals over the two composition
 * rings. Used for the whole run on the Dashboard and for one agent on its Overview.
 * `className` lets the host place the card in its grid (a bento span on the
 * Dashboard, nothing in the pane-responsive Overview grid).
 */
export function TokensWidget({
  usage,
  throughput,
  className,
  bare = false,
  wide = false,
}: {
  usage: UsageTally;
  /**
   * The scope's generation rate, shown at the trailing edge of the totals row. Given for
   * one agent profile (across every instance of it) and for one instance (across every call
   * it made) — the grains at which "how fast does this thing generate" is a property of the
   * thing rather than of the run. Omitted on the whole-run Dashboard, whose own Tokens / s
   * card already states the run's rate. Null where no call of the scope's was timed.
   */
  throughput?: number | null;
  className?: string;
  /**
   * Drop the card's own border/padding/background so the widget sits directly in
   * its host rather than as a boxed tile. Used on the agent Overview, whose panel
   * already frames the content, where a bordered card reads as a widget-in-a-widget;
   * the Dashboard's bento leaves it off so each tile keeps its card.
   */
  bare?: boolean;
  /**
   * The host gives this widget its column's full width, so the two composition rings sit
   * side by side rather than wrapping under one another. Left off in the Dashboard's bento,
   * where Tokens is the narrow tile beside Cost and stacking them is what fits.
   */
  wide?: boolean;
}) {
  const totalInput = usage.uncachedInput + usage.cachedInput;
  const totalOutput = usage.output + usage.reasoning;

  return (
    <div className={cardClass(bare, className)}>
      <span className={styles.cardLabel}>Tokens</span>
      {usage.anyTokens ? (
        <>
          <div className={styles.widgetTotals}>
            <Stat label="input" value={totalInput} sub="cached + uncached" />
            <Stat label="output" value={totalOutput} sub="reasoning + output" />
            <Stat label="total" value={usage.totalTokens} />
            {/* The rate rides at the far edge of the row it belongs to: it is the same
                tokens read against time rather than a fourth class of them, so it is set
                apart from the three counts instead of listed as one more. */}
            {throughput !== undefined && (
              <Stat
                label="tok/s"
                value={throughput}
                sub={throughput == null ? "no timed calls" : "generated"}
                className={styles.statTrailing}
              />
            )}
          </div>
          <div
            className={
              wide ? `${styles.ringRow} ${styles.ringRowWide}` : styles.ringRow
            }
          >
            <SplitRing
              label="Input caching"
              primary={{ label: "cached", value: usage.cachedInput }}
              secondary={{ label: "uncached", value: usage.uncachedInput }}
              total={totalInput}
              emptyMessage="No input tokens yet."
            />
            {/* Centered on the output share (not reasoning): "reasoning" is too
                long to sit legibly inside the ring, and output is the larger,
                headline class. The reasoning share stays readable off the arc and
                legend. */}
            <SplitRing
              label="Output tokens"
              primary={{ label: "output", value: usage.output }}
              secondary={{ label: "reasoning", value: usage.reasoning }}
              total={totalOutput}
              emptyMessage="No output tokens yet."
            />
          </div>
        </>
      ) : (
        <span className={styles.metricValue}>
          — <span className={styles.metricUnit}>tokens</span>
        </span>
      )}
    </div>
  );
}

// One figure in a widget's totals row: a big number over its class label (and, for
// the composed classes, the sum that makes it up). A null figure is a quantity the run
// could not measure, stated as a dash rather than as zero.
function Stat({
  label,
  value,
  sub,
  className,
  title,
}: {
  label: string;
  value: number | null;
  sub?: string;
  /** An extra class on the cell — the totals row's trailing placement. */
  className?: string;
  /** What the figure counts, spelled out on hover — for the cells whose label cannot. */
  title?: string;
}) {
  return (
    <div
      className={className ? `${styles.stat} ${className}` : styles.stat}
      title={title}
    >
      <span className={styles.statValue}>
        {value == null ? "—" : formatTokens(Math.round(value))}
      </span>
      <span className={styles.statLabel}>{label}</span>
      {sub && <span className={styles.statSub}>{sub}</span>}
    </div>
  );
}

// --- The error record ----------------------------------------------------------

// How many error types a ranking names before it stops. Three, because the point of a
// ranking is the narrowing: gg's taxonomy has twenty specific types, and a scope whose
// failures do not concentrate into a few of them is telling you that on its face.
export const TOP_ERROR_TYPES_SHOWN = 3;

/**
 * A scope's error rate as a sub-line: the rate with the denominator it was taken against,
 * and the worst streak within it.
 *
 * Never a bare percentage — 50% of two turns and 50% of two hundred are not the same claim
 * about a configuration — and a scope with no reported outcomes says so rather than
 * showing a clean record it has no evidence for.
 *
 * Shared by every scope that states an error rate (a profile's `errored turns` stat, an
 * instance's Errors widget), so the one thing a reader must not have to check — whether
 * "37% of 19" means the same on two panels of the same page — is not a thing two copies
 * could answer differently.
 */
export function errorRatePhrase(errors: GgErrorTally): string {
  if (errors.turns === 0) return "no turn outcomes reported";
  if (errors.errors === 0) return `none of ${numberFmt.format(errors.turns)}`;
  return `${formatPercent(errors.errors / errors.turns)} of ${numberFmt.format(
    errors.turns,
  )} · ${numberFmt.format(errors.maxConsecutive)} in a row at worst`;
}

/**
 * What a scope's discarded looping replies generated before they were thrown away, as one
 * phrase — or `null` when nothing was discarded, which is every scope that left loop
 * detection disarmed.
 *
 * Words and characters, and never tokens or a dollar figure. The provider reports usage at
 * the end of a stream an abandoned reply never reached, so these two are the only measures
 * of a discarded reply that were measured rather than guessed; putting a price beside a
 * count would read as though gg had one. This output IS billed and is deliberately absent
 * from the scope's cost, because a looping reply is a model defect and must not make the
 * configuration under test look expensive — which is exactly why the size is stated here.
 *
 * Shared by every scope that shows the count, so the two panels of one page cannot describe
 * the same discarded replies differently.
 */
export function discardedOutputPhrase(errors: GgErrorTally): string | null {
  if (errors.loopAborts === 0) return null;
  return `${numberFmt.format(errors.loopAbortWords)} words (${numberFmt.format(
    errors.loopAbortChars,
  )} characters) generated and thrown away`;
}

/**
 * A scope's errored turns ranked by specific type, most common first — or, where there is
 * no ranking to draw, which of the two nothings it is.
 *
 * The ranking is over the SPECIFIC types (`byType`), not the base kinds: "top error
 * types" over six buckets is barely a narrowing, and the base each type rolls up into
 * rides along on every row as a badge, so nothing the per-kind split said is lost.
 *
 * The two nothings stay two nothings, and conflating them would claim something the scope
 * does not say: no outcomes at all is not evidence of a clean run. There is no third — every
 * errored turn names its type, so `byType` sums to the errored turns and an empty ranking
 * with errors above it cannot occur.
 */
export function ErrorTypeRanking({ errors }: { errors: GgErrorTally }) {
  const top = topErrorTypes(errors, TOP_ERROR_TYPES_SHOWN);
  if (top.length === 0) {
    return (
      <span className={styles.metricUnit}>
        {errors.turns === 0
          ? "no turn outcomes reported yet"
          : "no errors to rank"}
      </span>
    );
  }
  return (
    <ul className={styles.errorTypes}>
      {top.map((row) => (
        <ErrorTypeRow key={row.id} row={row} />
      ))}
    </ul>
  );
}

// One row of the ranking: what failed, which base bucket it belongs to, and how often.
//
// The base kind rides as a badge because a specific type does not always name its own
// family — "syntax error" and "unknown name" say nothing about being a transpile failure
// and a program fault respectively, and that grouping is what the error ceilings are
// written against. It is withheld where the base's label and the row's label are the same
// string, since a badge that restates its row word for word is noise, and on a type from a
// newer gg than this console, which has no base to claim.
function ErrorTypeRow({ row }: { row: GgRankedError }) {
  const base = row.kind == null ? null : TURN_ERROR_LABELS[row.kind];
  return (
    <li className={styles.errorType}>
      <span className={styles.errorTypeLabel}>{row.label}</span>
      {base != null && base !== row.label && (
        <span className={styles.errorTypeBase}>{base}</span>
      )}
      <span className={styles.errorTypeCount}>
        {numberFmt.format(row.count)}
      </span>
    </li>
  );
}

// How many call-failure classes the ranking names. Three, for the same reason the type
// ranking stops at three: the reading is the narrowing.
export const TOP_CALL_FAILURES_SHOWN = 3;

/**
 * A scope's failed CALLS ranked by class, most common first.
 *
 * A different population from the ranking above it, which is why it is a second list and
 * never rows added to the first: that one counts turns against the turns that reported an
 * outcome, this one counts calls against no denominator this tally holds. A call that
 * failed inside a program the model then handled is not an errored turn at all — the typed
 * surface working is not the turn failing — so a run can rank empty above and long here,
 * and that combination is the finding rather than a contradiction. It is worth its own list
 * because a model fighting the same `not-found` forty times is one of the most actionable
 * facts a run has, and until this it was folded, tested, queryable and shown nowhere.
 *
 * `surface` names which of the two records is ranked, and the caption above says so out
 * loud: they are two disjoint populations — an agent has one surface and records its calls
 * on that one only — so neither is the run's total, and a ranking that did not say which it
 * was drawn from would be a figure whose population a reader could not state (see
 * `callFailureSurface`).
 *
 * The nothing is one nothing rather than the type ranking's two: every failed call carries
 * its class, so an empty record here is a scope whose calls all succeeded — or one that made
 * none, which this tally holds no count of calls to tell apart.
 */
export function CallFailureRanking({
  errors,
  surface,
}: {
  errors: GgErrorTally;
  surface: "tool" | "api";
}) {
  const top = topCallFailures(errors, surface, TOP_CALL_FAILURES_SHOWN);
  if (top.length === 0) {
    return <span className={styles.metricUnit}>no failed calls recorded</span>;
  }
  return (
    <ul className={styles.errorTypes}>
      {top.map((row) => (
        <ErrorTypeRow key={row.id} row={row} />
      ))}
    </ul>
  );
}

/**
 * The Errors widget: what the scope's turns failed at, in one card.
 *
 * Its errored-turn count against the turns that reported an outcome at all, the worst
 * unbroken streak of them, and the ranked split of what they were. On an instance's
 * Overview that is the instance's own record, folded from its own partition of the stream
 * — so the streak really is a streak, where the whole-run figure beside it on the
 * Dashboard is a peak over agents whose turns interleave (see
 * `GgErrorTally.maxConsecutive`).
 *
 * The count leads and the rate follows it, never the other way round: a rate is a derived
 * figure, and "50%" in the headline slot invites reading a run that has taken two turns as
 * though it meant something. The denominator travels with the rate for the same reason.
 *
 * Below the turn record sits the scope's failed CALLS, ranked by class. They are on this
 * card because they are what the model was fighting — the API-error attribution an
 * instance's Overview is opened for — and they are a *second* group on it rather than more
 * rows in the first because they count a different population (see
 * {@link CallFailureRanking}). They are deliberately not on the whole-run Dashboard's error
 * row: a class summed over every agent names no agent, and the reading that pays is "this
 * instance spent forty calls on the same `not-found`".
 */
export function ErrorsWidget({
  errors,
  executionMode,
  className,
  bare = false,
}: {
  errors: GgErrorTally;
  /**
   * How the scope's agent answers a turn (`GgAgentSurface.executionMode`), which picks
   * which call-failure record is ranked — see {@link callFailureSurface}. Omitted for a
   * scope that reported no surface, which falls back to the evidence in the tally.
   */
  executionMode?: string;
  className?: string;
  /** Drop the card chrome so the widget sits directly in its host — see {@link TokensWidget}. */
  bare?: boolean;
}) {
  const { turns, errors: failed, maxConsecutive, loopAborts } = errors;
  const surface = callFailureSurface(errors, executionMode);
  return (
    <div className={cardClass(bare, className)}>
      <span className={styles.cardLabel}>Errors</span>
      <div className={styles.widgetTotals}>
        {/* A stream with no outcomes on it at all — a scope that has not finished its
            first turn — says so rather than claiming a clean record, which is what a bare
            "0" would claim. */}
        <Stat
          label="errored turns"
          value={turns === 0 ? null : failed}
          sub={errorRatePhrase(errors)}
          title="Turns whose declared work could not be carried out — a failed model call, a program that did not compile, threw, or hit a sandbox ceiling, or a turn that declared no work at all. A tool call that failed inside a program that carried on is not one."
        />
        {/* The counter gg's own consecutive-error ceiling is enforced on: a scope reading
            "2 of 40 turns" is a different animal depending on whether those two were
            adjacent. */}
        <Stat
          label="worst streak"
          value={turns === 0 ? null : maxConsecutive}
          sub={
            turns === 0
              ? "no turn outcomes reported"
              : failed === 0
                ? "no turn errored"
                : "errored turns in a row"
          }
        />
        {/* Not an error — the retry succeeded — but money and wall-clock spent on nothing,
            which is the figure that says whether arming loop detection paid for itself.
            Absent on every scope that left it disarmed, which is the default. */}
        {loopAborts > 0 && (
          <Stat
            label="looping replies"
            value={loopAborts}
            sub={discardedOutputPhrase(errors) ?? "discarded, then retried"}
            title="Replies loop detection abandoned mid-stream before this scope got one it could use, and how much generation they cost. Not errors — each was retried and the turn is judged on what the retry produced. The output was billed by the provider and is deliberately absent from the recorded cost, in words and characters because an abandoned stream reports no tokens."
          />
        )}
      </div>
      <div className={styles.spendGroup}>
        <span className={styles.spendGroupLabel}>Top types</span>
        <ErrorTypeRanking errors={errors} />
      </div>
      {/* Named for the surface it is drawn from, never just "failed calls": the two records
          are disjoint populations and neither is the run's total, so a caption that did not
          say which one this is would leave a reader unable to state what the figures
          counted — and it must not read as more of the ranking above it, which counts
          turns. */}
      <div className={styles.spendGroup}>
        <span
          className={styles.spendGroupLabel}
          title={
            surface === "api"
              ? "Calls this agent's own programs were thrown, by class — the failures the MODEL met and had to write around, including the call the membrane refused before it ran. A different population from the turn errors above: a call that failed inside a program that carried on is not an errored turn."
              : "Dispatched tool calls that failed, by class — what gg ran and what it returned. A different population from the turn errors above: a call that failed on a turn the agent went on to complete is not an errored turn."
          }
        >
          Failed {surface === "api" ? "API" : "tool"} calls
        </span>
        <CallFailureRanking errors={errors} surface={surface} />
      </div>
    </div>
  );
}

/**
 * The Cost widget: the scope's total cost, its per-class split, an input-vs-output cost
 * ring, and — where the host supplies one — where the money went, per profile and per
 * model. The total is the run's authoritative `comparable` figure; the class split is
 * derived from catalog prices (`breakdown`) — per (profile, model) and summed, so a run
 * spanning several models splits exactly as a single-model one does — shown scaled to
 * that total, and omitted only when the catalog could price none of it.
 *
 * The per-slot/per-model breakdowns live *inside* this widget rather than beside it:
 * they are the same money the headline states, read by the role and by the model that
 * spent it, so they belong under the figure they decompose. Both are drawn as the same
 * proportional bars as the per-class split, so all three read in one visual language, and
 * both are always shown — a run that binds one model per profile lists the same rows twice,
 * which is a fact about that configuration rather than a reason to withhold the reading.
 */
export function CostWidget({
  usage,
  breakdown,
  spend,
  className,
  bare = false,
}: {
  usage: UsageTally;
  breakdown: GgCostBreakdown | null;
  /**
   * Where the run's money went — its per-slot and per-model spend (see
   * {@link GgSpendBreakdown}). Given on the whole-run Dashboard, whose cost is
   * accounted across every slot and model the run touched; omitted on an agent's
   * Overview, where the scope is one agent on one slot and the split would only
   * restate the headline.
   */
  spend?: GgSpendBreakdown | null;
  className?: string;
  /** Drop the card chrome so the widget sits directly in its host — see {@link TokensWidget}. */
  bare?: boolean;
}) {
  // Show the authoritative total when the run reported one; otherwise the derived
  // total is the best figure available.
  const displayTotal = usage.comparable ?? breakdown?.total ?? null;
  // Scale the derived per-class amounts so they sum to the total shown, reconciling
  // the split with the headline even when prices have drifted since the run.
  const scale =
    breakdown && displayTotal != null && breakdown.total > 0
      ? displayTotal / breakdown.total
      : 1;

  const inputCost = breakdown ? breakdown.input + breakdown.cachedInput : 0;
  const outputCost = breakdown ? breakdown.reasoning + breakdown.output : 0;

  return (
    <div className={cardClass(bare, className)}>
      <span className={styles.cardLabel}>Cost</span>
      <span className={styles.metricValue}>{formatCost(displayTotal)}</span>
      {usage.actual != null && usage.actual !== usage.comparable && (
        <span className={styles.metricUnit}>
          actual {formatCost(usage.actual)}
        </span>
      )}

      {breakdown ? (
        <>
          <ul className={styles.costRows}>
            <CostRow
              label="input"
              amount={breakdown.input * scale}
              fraction={breakdown.input / breakdown.total}
            />
            <CostRow
              label="cached input"
              amount={breakdown.cachedInput * scale}
              fraction={breakdown.cachedInput / breakdown.total}
            />
            <CostRow
              label="reasoning"
              amount={breakdown.reasoning * scale}
              fraction={breakdown.reasoning / breakdown.total}
            />
            <CostRow
              label="output"
              amount={breakdown.output * scale}
              fraction={breakdown.output / breakdown.total}
            />
          </ul>
          <SplitRing
            label="Input vs output"
            primary={{ label: "input", value: inputCost * scale }}
            secondary={{ label: "output", value: outputCost * scale }}
            total={breakdown.total * scale}
            emptyMessage="No priced tokens yet."
            formatValue={formatCost}
            className={styles.ringSpaced}
          />
        </>
      ) : (
        displayTotal != null && (
          // The split is derived from the model catalog's per-token prices, so the one
          // thing that can withhold it is the catalog — not the run. The backend seeds
          // prices at startup and at every enqueue, so reaching this fallback means
          // those fetches found nothing: say plainly that the model is not priceable,
          // rather than blaming gg for an accounting it does report.
          <p className={styles.cardNote}>
            No per-class split: the catalog has no prices for this run&rsquo;s
            model(s). Prices are fetched from OpenRouter before a run starts, so
            this usually means OpenRouter does not list the model.
          </p>
        )
      )}

      {spend && spend.perProfile.length > 0 && (
        <>
          {/* Where the money went by role. Every row names the model the profile was
              bound to: a profile is a role, and what it cost is a fact about the model
              behind it, so reading one without the other says nothing about why it
              cost that. */}
          <SpendSection
            label="Per agent"
            rows={spend.perProfile}
            total={displayTotal}
          />
          {/* And by model. Always shown, alongside Per agent, even on the common run that
              binds one model per profile and whose two lists therefore carry the same rows:
              which model a run's money went to is a question the widget should answer the
              same way every time, and a section that comes and goes with the run's model
              bindings makes its absence read as "no per-model spend" rather than as "the
              same figures you just read". */}
          <SpendSection
            label="Per model"
            rows={spend.perModel}
            total={displayTotal}
          />
        </>
      )}
    </div>
  );
}

// One spend breakdown inside the Cost widget: a labeled list of proportional bars, in
// the same visual language as the per-class split above it. `total` is the widget's
// headline figure — the rows are scaled to it so the split always sums to the number it
// decomposes, even where a row's cost had to be priced from the catalog.
function SpendSection({
  label,
  rows,
  total,
}: {
  label: string;
  rows: readonly SpendRow[];
  total: number | null;
}) {
  const rowsTotal = rows.reduce((sum, row) => sum + (row.cost ?? 0), 0);
  const scale = total != null && rowsTotal > 0 ? total / rowsTotal : 1;
  // The profile names this list carries twice. A name is display text a configuration may
  // hold two of, and two identically-named rows with different figures are unreadable
  // without the ids they are really accounted under.
  const seen = new Set<string>();
  const ambiguous = new Set<string>();
  for (const row of rows) {
    if (row.profile == null) continue;
    if (seen.has(row.profile)) ambiguous.add(row.profile);
    seen.add(row.profile);
  }
  return (
    <div className={styles.spendGroup}>
      <span className={styles.spendGroupLabel}>{label}</span>
      <ul className={styles.costRows}>
        {rows.map((row) => (
          <SpendRowView
            key={row.key}
            row={row}
            scale={scale}
            fraction={rowsTotal > 0 ? (row.cost ?? 0) / rowsTotal : 0}
            showId={row.profile != null && ambiguous.has(row.profile)}
          />
        ))}
      </ul>
    </div>
  );
}

// One profile's (or one model's) row: what it is over the model behind it, a proportional
// bar, and its cost over its token total — so the row reads as a magnitude, a figure,
// and a binding at once.
function SpendRowView({
  row,
  scale,
  fraction,
  showId,
}: {
  row: SpendRow;
  scale: number;
  fraction: number;
  /** Whether another row carries this row's profile name, so this one must show its id. */
  showId: boolean;
}) {
  return (
    <li className={styles.spendRow}>
      <span className={styles.spendRowIdentity}>
        <span
          className={styles.spendRowName}
          title={row.profileId ?? undefined}
        >
          {showId
            ? `${row.profile} (${row.profileId})`
            : (row.profile ?? row.modelName)}
        </span>
        {/* On a per-profile row the model is the binding behind the profile; on a
            per-model row the name above already *is* the model, so the id is not
            restated. */}
        {row.profileId != null && (
          <span className={styles.spendRowModel} title={row.modelId}>
            {row.modelName}
          </span>
        )}
      </span>
      <span className={styles.costRowBar} aria-hidden="true">
        <span
          className={styles.costRowBarFill}
          style={{ width: `${Math.min(Math.max(fraction, 0), 1) * 100}%` }}
        />
      </span>
      <span className={styles.spendRowFigures}>
        <span className={styles.spendRowAmount}>
          {formatCost(row.cost == null ? null : row.cost * scale)}
        </span>
        <span className={styles.spendRowTokens}>
          {shortTokens(row.tokens)} tok
        </span>
      </span>
    </li>
  );
}

// One class's cost row: a label, a proportional bar, and the dollar amount, so the
// split reads both as a magnitude and as a figure.
function CostRow({
  label,
  amount,
  fraction,
}: {
  label: string;
  amount: number;
  fraction: number;
}) {
  return (
    <li className={styles.costRow}>
      <span className={styles.costRowLabel}>{label}</span>
      <span className={styles.costRowBar} aria-hidden="true">
        <span
          className={styles.costRowBarFill}
          style={{ width: `${Math.min(Math.max(fraction, 0), 1) * 100}%` }}
        />
      </span>
      <span className={styles.costRowAmount}>{formatCost(amount)}</span>
    </li>
  );
}
