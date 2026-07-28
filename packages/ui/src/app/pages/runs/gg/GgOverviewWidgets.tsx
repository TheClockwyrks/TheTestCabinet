// The token and cost widgets shared by the two overview surfaces of a gg run: the
// whole-run Dashboard and, scoped to one agent, that agent's Overview file in the
// Agents explorer. Keeping them here — one Tokens widget, one Cost widget, one
// generic two-segment ring — is what makes an agent's overview read as the same
// dashboard, narrowed to that agent, rather than a different-looking panel.
//
// The Tokens widget shows the run's input and output totals (input = cached +
// uncached, output = reasoning + output) and absorbs the two composition rings
// (how much input was cached, how much output was reasoning). The Cost widget shows
// the total cost, its per-class split, and an input-vs-output cost ring; the split
// is derived from catalog prices (see ggCost.ts), since gg records only a total.

import type { ContextSnapshot, UsageTally } from "./useGgRunState";
import type { GgCostBreakdown } from "./ggCost";
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
  className,
  bare = false,
}: {
  usage: UsageTally;
  className?: string;
  /**
   * Drop the card's own border/padding/background so the widget sits directly in
   * its host rather than as a boxed tile. Used on the agent Overview, whose panel
   * already frames the content, where a bordered card reads as a widget-in-a-widget;
   * the Dashboard's bento leaves it off so each tile keeps its card.
   */
  bare?: boolean;
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
          </div>
          <div className={styles.ringRow}>
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
// the composed classes, the sum that makes it up).
function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: number;
  sub?: string;
}) {
  return (
    <div className={styles.stat}>
      <span className={styles.statValue}>{formatTokens(value)}</span>
      <span className={styles.statLabel}>{label}</span>
      {sub && <span className={styles.statSub}>{sub}</span>}
    </div>
  );
}

/**
 * The Cost widget: the scope's total cost, its per-class split, and an input-vs-output
 * cost ring. The total is the run's authoritative `comparable` figure; the split is
 * derived from catalog prices (`breakdown`), so it is shown scaled to that total and
 * omitted entirely when no breakdown could be priced.
 */
export function CostWidget({
  usage,
  breakdown,
  className,
  bare = false,
}: {
  usage: UsageTally;
  breakdown: GgCostBreakdown | null;
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
          <p className={styles.cardNote}>
            Per-class cost isn&rsquo;t recorded by gg — only the total.
          </p>
        )
      )}
    </div>
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
