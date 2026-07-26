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
  fsm: FsmProgress | null;
  /** The run's recorded configuration — its independent variable. */
  capabilitySet: GgCapabilitySet | null;
  /** Notices under the cards: the terminal outcome, a stream error, the replay link. */
  children?: ReactNode;
}

/**
 * The Dashboard panel of a gg run: everything about the run *as a whole* rather
 * than about one of its capabilities — its status, the running token/cost tally,
 * the configuration it ran under, and the enforced FSM process when a machine
 * drives it.
 *
 * It is the first panel on both surfaces a gg run is read through (the live
 * monitor and a finished run's gg tab), so the run-level read-out no longer
 * competes with the panels for the top of the page: the panel selector leads, and
 * the summary is simply the panel it selects first.
 */
export function GgDashboard({
  status,
  usage,
  fsm,
  capabilitySet,
  children,
}: GgDashboardProps) {
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
          <div className={styles.breakdown}>
            <span>
              <span className={styles.breakdownKey}>in</span>
              {formatTokens(usage.uncachedInput)}
            </span>
            <span>
              <span className={styles.breakdownKey}>cached</span>
              {formatTokens(usage.cachedInput)}
            </span>
            <span>
              <span className={styles.breakdownKey}>out</span>
              {formatTokens(usage.output)}
            </span>
            <span>
              <span className={styles.breakdownKey}>reasoning</span>
              {formatTokens(usage.reasoning)}
            </span>
          </div>
          <span className={styles.metricCost}>
            {formatCost(usage.comparable)}
            {usage.actual != null && usage.actual !== usage.comparable && (
              <span className={styles.metricUnit}>
                {" "}
                (actual {formatCost(usage.actual)})
              </span>
            )}
          </span>
        </div>

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
