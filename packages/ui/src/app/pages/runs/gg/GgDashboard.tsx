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
import {
  ROOT_ID,
  ggPeakContext,
  ggToolBreakdown,
  shortTokens,
} from "./useGgRunState";
import {
  pricedSlots,
  runSlotUsage,
  useGgCostBreakdown,
  useGgSpend,
} from "./ggCost";
import { CostWidget, TokensWidget, formatPercent } from "./GgOverviewWidgets";
import { useGgExplorerNav } from "./GgExplorerNav";
import styles from "./GgDashboard.module.scss";

// Grouped digits for the whole-run counts the Dashboard states as bare figures (the
// turn count), so a long run reads as "1,204" rather than "1204".
const numberFmt = new Intl.NumberFormat("en-US");

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
 * the configuration) and the whole-run spend split inside the Cost widget.
 *
 * It is the first panel on both surfaces a gg run is read through (the live
 * monitor and a finished run's gg tab), so the run-level read-out no longer
 * competes with the panels for the top of the page: the panel selector leads, and
 * the summary is simply the panel it selects first. The cards are laid out as a
 * bento — the tiles in a row share a height but vary in width, so the token and
 * cost widgets get the room their rings and splits want while the smaller stats
 * stay narrow, and no gap opens between two same-row tiles of different content
 * heights. Cost leads the money row as the tall tile, since it carries the run's whole
 * account of its spend — the total, the per-class split, and where that money went per
 * slot and per model, across all the run's models rather than scoped to any one agent
 * — with Tokens beside it and the configuration slotted in underneath.
 *
 * Both surfaces get the *same* layout: the one difference is the status card, which a
 * finished run omits because the run detail page's own header already carries its state
 * (and the turn count then takes that row alone, rather than reflowing everything below
 * it).
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
  // The run's spend, per (slot, model): the split gg's attributed `usage` deltas carry
  // from the first turn, or — on a stream whose deltas carry no attribution — the same
  // rollup reconstructed from each agent's own tally at the model it was bound to. Either
  // way it is available *while the run runs*, rather than waiting on the end-of-agent
  // `slot_usage` rollups.
  const runSlots = useMemo(
    () => runSlotUsage(slotUsage, perAgent, agentForest),
    [slotUsage, perAgent, agentForest],
  );
  // Priced per (profile, model) and summed — never at one blanket rate — so a run that
  // spans several models gets the same per-class split a single-model run does.
  const costBreakdown = useGgCostBreakdown(
    useMemo(() => pricedSlots(runSlots), [runSlots]),
  );
  // And where that money went: per slot (which role spent it, and on which model) and
  // per model (the same spend folded across the slots one model is bound to).
  const spend = useGgSpend(runSlots);

  // The run's total turns across every agent — one per `turn_started`, summed over the
  // per-agent partitions (each turn is stamped with exactly one agent, so the sum is
  // the whole-run count). A session-level figure, so it reads at the top of the
  // Dashboard beside the status rather than inside the agents card.
  const totalTurns = useMemo(
    () =>
      [...perAgent.values()].reduce((sum, state) => sum + state.turnCount, 0),
    [perAgent],
  );

  return (
    <div className={styles.dashboard}>
      <div className={styles.cards}>
        {/* The top row: where the run is at. The live monitor pairs the status with the
            turn count; a finished run's gg tab has its state in the page's own header,
            so the turn count takes the whole row there rather than leaving a hole where
            the status card would have been — the row below it is then identical on both
            surfaces. */}
        {status && <StatusCard status={status} />}
        <TurnsCard
          turns={totalTurns}
          agents={perAgent.size}
          className={status ? styles.cardHalf : styles.cardFull}
        />

        {/* The money row, laid out as its own block so it reads the same whether or not
            a status card precedes it (its two columns are fixed here rather than
            wherever the bento's auto-placement happens to leave them). Cost leads, and
            is the tall tile: it carries the whole account of the run's spend — the
            total, the per-class split, the input-vs-output ring, and where the money
            went per slot and per model. Tokens sits beside it with the configuration
            slotted in underneath, filling the height Cost takes. */}
        <div className={styles.spendBlock}>
          <CostWidget usage={usage} breakdown={costBreakdown} spend={spend} />
          <div className={styles.spendBlockSide}>
            <TokensWidget usage={usage} />
            {capabilitySet && <ConfigurationCard set={capabilitySet} />}
          </div>
        </div>

        <AgentsCard agentForest={agentForest} perAgent={perAgent} />
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
  depth: number;
  status: GgAgentStatus;
  slot: string | null;
  /** How many turns this agent took — its own partition of the run's total. */
  turns: number;
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
      // Only the main agent is "root". A board-dispatched issue agent is parentless
      // too — it is a top-level tree of its own in the forest — but its id *is* its
      // name (`AUTH-1.0i`, its reviewers `AUTH-1.0i.0r`), so keying the label on
      // being parentless named every dispatched agent "root".
      label: node.id === ROOT_ID ? "root" : node.id,
      depth,
      status: node.status,
      slot: node.slot,
      turns: st?.turnCount ?? 0,
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
      {/* Just the count: the run's total turns read on the Turns card at the top of
          the Dashboard (a session fact, not an agent one), and the rows are visibly
          clickable, so neither needs a caption here. */}
      <span className={styles.cardLabel}>Agents · {rows.length}</span>
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
        {/* The agent's instance name alone on the first line, with its profile and
            its own turn count as the meta line beneath — how much of the session this
            agent spent is a per-agent fact, so it hangs under the name it belongs to
            rather than being summed away into one figure, and the profile reads beside
            it rather than crowding the name it annotates. A dot joins the pair, the
            way depth · turns is joined on an agent's Overview. */}
        <span className={styles.agentIdentityText}>
          <span className={styles.agentName}>{row.label}</span>
          <span className={styles.agentMetaLine}>
            {row.slot && (
              <>
                <span className={styles.agentSlot}>{row.slot}</span>
                <span className={styles.agentMetaSep} aria-hidden="true">
                  ·
                </span>
              </>
            )}
            <span className={styles.agentTurns}>
              {row.turns} turn{row.turns === 1 ? "" : "s"}
            </span>
          </span>
        </span>
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

// The session's turn count: how many model request/response cycles the run has spent,
// across every agent. It pairs on the top row with the status — the two facts that
// answer "where is this run at" — so the status card gives up the full width it used
// to take and the pair fills the row between them. Where there is no status card (a
// finished run, whose state its page header already carries) it takes the row alone.
function TurnsCard({
  turns,
  agents,
  className,
}: {
  turns: number;
  agents: number;
  /** The bento span the card takes: half the row beside a status card, the full row alone. */
  className: string | undefined;
}) {
  return (
    <div className={`${styles.card} ${className}`}>
      <span className={styles.cardLabel}>Turns</span>
      <span className={styles.metricValue}>{numberFmt.format(turns)}</span>
      <span className={styles.metricUnit}>
        {turns === 1 ? "turn" : "turns"} across {agents}{" "}
        {agents === 1 ? "agent" : "agents"}
      </span>
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
    // Seven of the twelve columns, not the full row: the turn count sits beside it.
    <div className={`${styles.card} ${styles.cardWide}`}>
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

// The run's configuration: the preset it came from (when named), and — per agent
// profile — the model it ran on and which capabilities were on. This is the run's
// independent variable, so it reads as a first-class card rather than a footnote.
function ConfigurationCard({ set }: { set: GgCapabilitySet }) {
  const agents = set.agents ?? [];
  return (
    <div className={`${styles.card} ${styles.cardWide}`}>
      <span className={styles.cardLabel}>Configuration</span>
      {set.preset && <span className={styles.configPreset}>{set.preset}</span>}
      {agents.map((agent) => {
        const enabled = agent.capabilities
          .filter((c) => c.enabled)
          .map((c) => c.id);
        return (
          <div key={agent.name} className={styles.agentConfig}>
            <div className={styles.slots}>
              <span className={styles.slot}>
                <span className={styles.slotName}>{agent.name}</span>
                {agent.modelId}
              </span>
            </div>
            <div className={styles.capabilities}>
              {enabled.length === 0 ? (
                <span className={styles.capabilityNone}>
                  no capabilities enabled
                </span>
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
      })}
    </div>
  );
}
