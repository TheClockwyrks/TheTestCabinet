import type { ReactNode } from "react";
import type { GgCapabilitySet } from "@test-cabinet/run-record/gg";
import { FsmStateStrip } from "./FsmStateStrip";
import type { FsmProgress, SlotUsage, UsageTally } from "./useGgRunState";
import { soleModelId, useGgCostBreakdown } from "./ggCost";
import { CostWidget, TokensWidget } from "./GgOverviewWidgets";
import { SlotUsagePanel } from "./AgentTreeView";
import styles from "./GgDashboard.module.scss";

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
  /** The per-(slot, model) usage rollups, used to price the cost split per model. */
  slotUsage: SlotUsage[];
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
 * than about one of its agents — its status, the running token and cost tallies
 * with their caching/reasoning/cost splits, how many agents ran, the configuration
 * it ran under, and the enforced FSM process when a machine drives it.
 *
 * It is an overview of the entire session; an agent's Overview file in the Agents
 * explorer is this same read-out narrowed to that agent (the Tokens and Cost
 * widgets are shared), minus the session-scoped cards (status, agent count, the
 * configuration, the per-slot usage tally).
 *
 * It is the first panel on both surfaces a gg run is read through (the live
 * monitor and a finished run's gg tab), so the run-level read-out no longer
 * competes with the panels for the top of the page: the panel selector leads, and
 * the summary is simply the panel it selects first. The cards are laid out as a
 * bento — the tiles in a row share a height but vary in width, so the token and
 * cost widgets get the room their rings and splits want while the smaller stats
 * stay narrow, and no gap opens between two same-row tiles of different content
 * heights. The per-slot usage tally — the breakdown behind the cost total — reads
 * here across all the run's models, not scoped to any one agent.
 */
export function GgDashboard({
  status,
  usage,
  slotUsage,
  agentCount,
  fsm,
  capabilitySet,
  children,
}: GgDashboardProps) {
  const costBreakdown = useGgCostBreakdown(
    slotUsage,
    usage,
    soleModelId(capabilitySet),
  );

  return (
    <div className={styles.dashboard}>
      <div className={styles.cards}>
        {status && <StatusCard status={status} />}

        <TokensWidget usage={usage} className={styles.cardWide} />
        <CostWidget
          usage={usage}
          breakdown={costBreakdown}
          className={styles.cardHalf}
        />

        <div
          className={`${styles.card} ${styles.cardThird} ${styles.cardCenter}`}
        >
          <span className={styles.cardLabel}>Agents</span>
          <span className={styles.metricValue}>
            {agentCount}{" "}
            <span className={styles.metricUnit}>
              agent{agentCount === 1 ? "" : "s"}
            </span>
          </span>
        </div>

        {capabilitySet && <ConfigurationCard set={capabilitySet} />}

        {/* The per-slot usage breakdown behind the cost total: a gg run spans one
            model per slot, so cost is accounted per slot rather than as one figure.
            A whole-run fact across every agent, so it reads here, full width, rather
            than on any single agent's Overview. Absent on a single-model run that
            emitted only the global usage deltas. */}
        {slotUsage.length > 0 && (
          <div className={`${styles.card} ${styles.cardFull}`}>
            <SlotUsagePanel slotUsage={slotUsage} />
          </div>
        )}
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
    <div className={`${styles.card} ${styles.cardFull}`}>
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
    <div className={`${styles.card} ${styles.cardTwoThirds}`}>
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
