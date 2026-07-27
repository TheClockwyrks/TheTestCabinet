import { useMemo, type ReactNode } from "react";
import type {
  GgAgentStatus,
  GgCapabilitySet,
} from "@test-cabinet/run-record/gg";
import { FsmStateStrip } from "./FsmStateStrip";
import type {
  AgentTreeNode,
  DerivedGgState,
  FsmProgress,
  SlotUsage,
  UsageTally,
} from "./useGgRunState";
import { ggPeakContext, ggToolBreakdown, shortTokens } from "./useGgRunState";
import { soleModelId, useGgCostBreakdown } from "./ggCost";
import { CostWidget, TokensWidget, formatPercent } from "./GgOverviewWidgets";
import { SlotUsagePanel } from "./AgentTreeView";
import { useGgExplorerNav } from "./GgExplorerNav";
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
  /**
   * Each agent's own reduced slice, keyed by agent id (always including the root) —
   * what the agent overview reads its per-agent context/token/tool figures from.
   */
  perAgent: Map<string, DerivedGgState>;
  /**
   * The delegation forest — the agent overview lists agents in forest order (root
   * first, then each dispatched top-level agent) and indents subagents under their
   * spawner.
   */
  agentForest: AgentTreeNode[];
  fsm: FsmProgress | null;
  /** The run's recorded configuration — its independent variable. */
  capabilitySet: GgCapabilitySet | null;
  /** Notices under the cards: the terminal outcome, a stream error, the replay link. */
  children?: ReactNode;
}

/**
 * The Dashboard panel of a gg run: everything about the run *as a whole* rather
 * than about one of its agents — its status, the running token and cost tallies
 * with their caching/reasoning/cost splits, an overview of the agents that ran, the
 * configuration it ran under, and the enforced FSM process when a machine drives it.
 *
 * The agent overview is a row per agent (its peak context, its token share, and the
 * tools it used), each a link into that agent's files in the Agents explorer — so
 * the whole-run view leads into the per-agent one.
 *
 * It is an overview of the entire session; an agent's Overview file in the Agents
 * explorer is this same read-out narrowed to that agent (the Tokens and Cost
 * widgets are shared), minus the session-scoped cards (status, the agent overview,
 * the configuration, the per-slot usage tally).
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
  perAgent,
  agentForest,
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

        <AgentsCard agentForest={agentForest} perAgent={perAgent} />

        {/* The per-slot usage breakdown behind the cost total: a gg run spans one
            model per slot, so cost is accounted per slot rather than as one figure.
            A whole-run fact across every agent, so it reads here rather than on any
            single agent's Overview. It pairs on one row with the configuration — the
            narrow tile (mirroring the Cost widget's width) on the left, the
            configuration the wider tile beside it. Absent on a single-model run that
            emitted only the global usage deltas. */}
        {slotUsage.length > 0 && (
          <div className={`${styles.card} ${styles.cardHalf}`}>
            <SlotUsagePanel slotUsage={slotUsage} />
          </div>
        )}

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

// How many tool chips a Dashboard agent row shows before collapsing the rest into a
// "+N" — enough to read what an agent leaned on without letting a tool-heavy agent
// wrap into a wall of chips.
const OVERVIEW_TOOLS_SHOWN = 6;

// One agent's row in the Dashboard's agent overview: its identity, the peak its
// context window reached, its share of the run's tokens, and the tools it used.
interface AgentOverviewRowData {
  id: string;
  label: string;
  isRoot: boolean;
  depth: number;
  status: GgAgentStatus;
  slot: string | null;
  peakTokens: number;
  peakFullness: number | null;
  tokenShare: number;
  tools: string[];
}

// Walk the delegation tree into an ordered, indented row list (root first, each
// subagent under its spawner), pulling each agent's peak context, token share, and
// tools from its own reduced slice. Token share is taken against the sum of every
// agent's tokens, so the shares are a true partition of the run that always totals
// 100% — rather than against the run-level tally, which is accounted per slot and a
// slot can span more than one agent.
function buildAgentRows(
  forest: AgentTreeNode[],
  perAgent: Map<string, DerivedGgState>,
): AgentOverviewRowData[] {
  const ordered: Array<{ node: AgentTreeNode; depth: number }> = [];
  const walk = (node: AgentTreeNode, depth: number) => {
    ordered.push({ node, depth });
    node.children.forEach((child) => walk(child, depth + 1));
  };
  forest.forEach((root) => walk(root, 0));

  const runTokens = ordered.reduce(
    (sum, { node }) => sum + (perAgent.get(node.id)?.usage.totalTokens ?? 0),
    0,
  );

  return ordered.map(({ node, depth }) => {
    const st = perAgent.get(node.id);
    const peak = st ? ggPeakContext(st) : null;
    const tokens = st?.usage.totalTokens ?? 0;
    return {
      id: node.id,
      label: node.parentId == null ? "root" : node.id,
      isRoot: node.parentId == null,
      depth,
      status: node.status,
      slot: node.slot,
      peakTokens: peak?.tokens ?? 0,
      peakFullness: peak?.fullness ?? null,
      tokenShare: runTokens > 0 ? tokens / runTokens : 0,
      tools: st ? ggToolBreakdown(st).tools.map((t) => t.name) : [],
    };
  });
}

// The Agents card: an overview of every agent that ran, in place of a bare count.
// Each row gives the agent's peak context usage, its share of the run's tokens, and
// the tools it leaned on — and clicking it opens that agent's files in the Agents
// explorer (when the panels provide the navigation channel; a Dashboard shown
// outside them renders the rows as plain, un-clickable stats).
function AgentsCard({
  agentForest,
  perAgent,
}: {
  agentForest: AgentTreeNode[];
  perAgent: Map<string, DerivedGgState>;
}) {
  const nav = useGgExplorerNav();
  const rows = useMemo(
    () => buildAgentRows(agentForest, perAgent),
    [agentForest, perAgent],
  );

  return (
    <div className={`${styles.card} ${styles.cardFull}`}>
      <span className={styles.cardLabel}>
        Agents · {rows.length}
        {nav && rows.length > 1 && (
          <span className={styles.agentsHint}>
            {" "}
            — select one to open its files
          </span>
        )}
      </span>
      <ul className={styles.agentOverview}>
        {rows.map((row) => (
          <AgentOverviewRow
            key={row.id}
            row={row}
            onOpen={nav ? () => nav.openAgent(row.id) : undefined}
          />
        ))}
      </ul>
    </div>
  );
}

function AgentOverviewRow({
  row,
  onOpen,
}: {
  row: AgentOverviewRowData;
  onOpen?: () => void;
}) {
  const contextLevel =
    row.peakFullness == null
      ? undefined
      : row.peakFullness >= 0.9
        ? "high"
        : row.peakFullness >= 0.7
          ? "mid"
          : "low";
  const inner = (
    <>
      <span
        className={styles.agentIdentity}
        style={{ paddingLeft: `${row.depth * 0.9}rem` }}
      >
        <span
          className={styles.agentDot}
          data-status={row.status}
          aria-hidden="true"
        />
        <span className={styles.agentName}>{row.label}</span>
        {row.slot && <span className={styles.agentSlot}>{row.slot}</span>}
      </span>

      <span className={styles.agentMetric}>
        <span className={styles.agentMetricLabel}>max context</span>
        <span className={styles.agentMeter} aria-hidden="true">
          <span
            className={styles.agentMeterFill}
            data-level={contextLevel}
            style={{ width: `${(row.peakFullness ?? 0) * 100}%` }}
          />
        </span>
        <span className={styles.agentMetricValue}>
          {row.peakFullness != null
            ? `${Math.round(row.peakFullness * 100)}%`
            : row.peakTokens > 0
              ? shortTokens(row.peakTokens)
              : "—"}
        </span>
      </span>

      <span className={styles.agentMetric}>
        <span className={styles.agentMetricLabel}>tokens</span>
        <span className={styles.agentMeter} aria-hidden="true">
          <span
            className={styles.agentMeterFill}
            style={{ width: `${row.tokenShare * 100}%` }}
          />
        </span>
        <span className={styles.agentMetricValue}>
          {formatPercent(row.tokenShare)}
        </span>
      </span>

      <span className={styles.agentTools}>
        {row.tools.length === 0 ? (
          <span className={styles.agentToolsNone}>no tools</span>
        ) : (
          <>
            {row.tools.slice(0, OVERVIEW_TOOLS_SHOWN).map((tool) => (
              <span key={tool} className={styles.capability}>
                {tool}
              </span>
            ))}
            {row.tools.length > OVERVIEW_TOOLS_SHOWN && (
              <span className={styles.agentToolsMore}>
                +{row.tools.length - OVERVIEW_TOOLS_SHOWN}
              </span>
            )}
          </>
        )}
      </span>
    </>
  );

  return (
    <li className={styles.agentRow}>
      {onOpen ? (
        <button
          type="button"
          className={styles.agentRowButton}
          onClick={onOpen}
          aria-label={`Open ${row.label}`}
        >
          {inner}
        </button>
      ) : (
        <div className={styles.agentRowStatic}>{inner}</div>
      )}
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
    <div className={`${styles.card} ${styles.cardWide}`}>
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
