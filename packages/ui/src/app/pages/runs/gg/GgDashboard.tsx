import type { ReactNode } from "react";
import type { GgCapabilitySet } from "@test-cabinet/run-record/gg";
import { FsmStateStrip } from "./FsmStateStrip";
import type { FsmProgress, UsageTally } from "./useGgRunState";
import styles from "./GgDashboard.module.scss";

const numberFmt = new Intl.NumberFormat("en-US");
function formatTokens(n: number): string {
  return numberFmt.format(n);
}
function formatCost(n: number | null): string {
  return n == null ? "—" : `$${n.toFixed(4)}`;
}
// A share as a whole percent, with a `<1%` floor so a rare-but-present slice never
// rounds away to nothing and an exact `0%` when the class is truly empty.
function formatPercent(fraction: number): string {
  const pct = fraction * 100;
  if (pct === 0) return "0%";
  if (pct < 1) return "<1%";
  return `${Math.round(pct)}%`;
}

// The run's lifecycle read-out, as the host page knows it. Only the live monitor
// has one: on a finished run's gg tab the run's own header already carries its
// state, so that host omits the card rather than restating it.
export interface GgDashboardStatus {
  label: string;
  detail: string | null;
  /** Which cue the pill takes: a live phase glows, a terminal one reads by outcome. */
  tone: "live" | "ok" | "fail";
  /** A secondary line under the pill (e.g. the gg session ending before the stream does). */
  note?: string | null;
  /** A control on the status line's trailing edge (the live monitor's kill affordance). */
  action?: ReactNode;
}

interface GgDashboardProps {
  status?: GgDashboardStatus;
  usage: UsageTally;
  /** How many agents ran (the root plus every subagent it spawned). */
  agentCount: number;
  fsm: FsmProgress | null;
  /** The run's recorded configuration — its independent variable. */
  capabilitySet: GgCapabilitySet | null;
  /** Notices under the cards: the terminal outcome, a stream error, the replay link. */
  children?: ReactNode;
}

/**
 * The Dashboard panel of a gg run: everything about the run *as a whole* rather
 * than about one of its agents — its status, the running token/cost tally with its
 * caching and reasoning splits, how many agents ran, the configuration it ran
 * under, and the enforced FSM process when a machine drives it.
 *
 * It is the first panel on both surfaces a gg run is read through (the live
 * monitor and a finished run's gg tab), so the run-level read-out no longer
 * competes with the panels for the top of the page: the panel selector leads, and
 * the summary is simply the panel it selects first.
 */
export function GgDashboard({
  status,
  usage,
  agentCount,
  fsm,
  capabilitySet,
  children,
}: GgDashboardProps) {
  const totalInput = usage.uncachedInput + usage.cachedInput;
  const totalOutput = usage.output + usage.reasoning;

  return (
    <div className={styles.dashboard}>
      <div className={styles.cards}>
        {status && <StatusCard status={status} />}

        <div className={styles.card}>
          <span className={styles.cardLabel}>Tokens &amp; cost</span>
          <span className={styles.metricValue}>
            {usage.anyTokens ? formatTokens(usage.totalTokens) : "—"}{" "}
            <span className={styles.metricUnit}>tokens</span>
          </span>
          <span className={styles.metricCost}>
            {formatCost(usage.comparable)}
            {usage.actual != null && usage.actual !== usage.comparable && (
              <span className={styles.metricUnit}>
                {" "}
                (actual {formatCost(usage.actual)})
              </span>
            )}
          </span>
          <span className={styles.agentsStat}>
            <span className={styles.agentsCount}>{agentCount}</span>{" "}
            <span className={styles.metricUnit}>
              agent{agentCount === 1 ? "" : "s"}
            </span>
          </span>
        </div>

        {/* The two-segment splits the run's tokens break into, each a ring with the
            raw counts in its legend: how much input was served from cache, and how
            much output was reasoning. */}
        <TokenRing
          title="Input caching"
          primary={{ label: "cached", value: usage.cachedInput }}
          secondary={{ label: "uncached", value: usage.uncachedInput }}
          total={totalInput}
          emptyMessage="No input tokens yet."
        />
        <TokenRing
          title="Output reasoning"
          primary={{ label: "reasoning", value: usage.reasoning }}
          secondary={{ label: "output", value: usage.output }}
          total={totalOutput}
          emptyMessage="No output tokens yet."
        />

        {capabilitySet && <ConfigurationCard set={capabilitySet} />}
      </div>

      {/* The enforced FSM process, when a machine drives the run: the current state
          shown on the ordered machine path. Renders nothing when no FSM is
          configured. */}
      <FsmStateStrip fsm={fsm} />

      {children}
    </div>
  );
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

// A ring card breaking one token class into two shares. The center reads the
// primary share as a percent (e.g. "62% cached"); the legend gives both segments'
// raw token counts and shares, so the ring replaces the old text-only breakdown
// without losing the numbers. Empty (no tokens of this class yet) reads as a note.
function TokenRing({
  title,
  primary,
  secondary,
  total,
  emptyMessage,
}: {
  title: string;
  primary: RingSegment;
  secondary: RingSegment;
  total: number;
  emptyMessage: string;
}) {
  const primaryFraction = total > 0 ? primary.value / total : 0;
  const secondaryFraction = total > 0 ? secondary.value / total : 0;
  const primaryDash = primaryFraction * RING_CIRC;
  // The secondary arc starts where the primary ends (clockwise from 12 o'clock).
  const secondaryOffset = -primaryFraction * RING_CIRC;
  const secondaryDash = secondaryFraction * RING_CIRC;

  return (
    <div className={styles.card}>
      <span className={styles.cardLabel}>{title}</span>
      {total === 0 ? (
        <p className={styles.ringEmpty}>{emptyMessage}</p>
      ) : (
        <div className={styles.ringBody}>
          <svg
            className={styles.ring}
            viewBox={`0 0 ${RING_BOX} ${RING_BOX}`}
            role="img"
            aria-label={`${title}: ${formatPercent(primaryFraction)} ${
              primary.label
            } (${formatTokens(primary.value)}), ${formatPercent(
              secondaryFraction,
            )} ${secondary.label} (${formatTokens(secondary.value)})`}
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
            />
            <RingLegendRow
              variant="secondary"
              label={secondary.label}
              value={secondary.value}
              fraction={secondaryFraction}
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
}: {
  variant: "primary" | "secondary";
  label: string;
  value: number;
  fraction: number;
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
        {formatTokens(value)} · {formatPercent(fraction)}
      </span>
    </li>
  );
}

function StatusCard({ status }: { status: GgDashboardStatus }) {
  const toneClass =
    status.tone === "ok"
      ? styles.pillOk
      : status.tone === "fail"
        ? styles.pillFail
        : styles.pillLive;
  return (
    <div className={styles.card}>
      <span className={styles.cardLabel}>Status</span>
      <div className={styles.statusLine}>
        <span className={`${styles.pill} ${toneClass}`}>{status.label}</span>
        {status.detail && (
          <span className={styles.statusDetail}>{status.detail}</span>
        )}
        {status.action && (
          <span className={styles.statusAction}>{status.action}</span>
        )}
      </div>
      {status.note && (
        <span className={styles.statusDetail}>{status.note}</span>
      )}
    </div>
  );
}

// The run's configuration: the preset it came from (when named), which capabilities
// were on, and the model bound to each slot. This is the run's independent
// variable, so it reads as a first-class card rather than a footnote.
function ConfigurationCard({ set }: { set: GgCapabilitySet }) {
  const enabled = set.capabilities.filter((c) => c.enabled).map((c) => c.id);
  return (
    <div className={styles.card}>
      <span className={styles.cardLabel}>Configuration</span>
      {set.preset && <span className={styles.configPreset}>{set.preset}</span>}
      <div className={styles.slots}>
        {set.slots.map((slot) => (
          <span key={slot.slot} className={styles.slot}>
            <span className={styles.slotName}>{slot.slot}</span>
            {slot.modelId}
          </span>
        ))}
      </div>
      <div className={styles.capabilities}>
        {enabled.length === 0 ? (
          <span className={styles.capabilityNone}>no capabilities enabled</span>
        ) : (
          enabled.map((id) => (
            <span key={id} className={styles.capability}>
              {id}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
