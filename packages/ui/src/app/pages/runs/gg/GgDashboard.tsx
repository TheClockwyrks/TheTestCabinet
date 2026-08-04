import { useMemo, type ReactNode } from "react";
import type {
  GgAgentStatus,
  GgCapabilitySet,
} from "@test-cabinet/run-record/gg";
import type {
  AgentTreeNode,
  DerivedGgState,
  SlotUsage,
  UsageTally,
} from "./useGgRunState";
import {
  ROOT_ID,
  TURN_ERROR_LABELS,
  addErrorTally,
  emptyErrorTally,
  ggPeakContext,
  ggToolBreakdown,
  shortTokens,
  topErrorTypes,
  type GgErrorTally,
  type GgRankedError,
} from "./useGgRunState";
import {
  pricedSlots,
  runSlotUsage,
  useGgCostBreakdown,
  useGgSpend,
} from "./ggCost";
import {
  formatThroughput,
  formatThroughputValue,
  useGgThroughput,
  type GgThroughput,
} from "./ggThroughput";
import { formatLimit, formatRuntime, type GgRuntime } from "./ggRuntime";
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
  // `stopped` is neither: an operator ended the run, so it is terminal without being an
  // outcome. It reads muted rather than negative, because painting a killed run red
  // reports a failure that did not happen.
  tone: "live" | "ok" | "fail" | "stopped";
  /** A secondary line under the pill (e.g. the gg session ending before the stream does). */
  note?: string | null;
  /** A control on the card's label row, trailing edge (the live monitor's kill affordance). */
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
  /** The run's recorded configuration — its independent variable. */
  capabilitySet: GgCapabilitySet | null;
  /**
   * The run's two clocks — its wall clock and its agents' summed runtime (see
   * {@link GgRuntime}). The host derives it, since only the host knows whether the stream
   * is still arriving and therefore which clock a running span is measured against.
   */
  runtime: GgRuntime;
  /**
   * The wall-clock ceiling the run is bounded by, in seconds — the test case's own
   * `max_runtime_hours`, which is what the host stops a run at. Null where the catalog could
   * not be reached to resolve it, in which case the Time limit card states exactly that
   * rather than disappearing (see {@link RuntimeRow}).
   */
  timeoutSeconds: number | null;
  /**
   * Notices above the cards: the terminal outcome, a stream error, the replay link. They
   * lead the panel rather than trailing it — a run that has just finished should say so
   * where the reader is already looking, not at the foot of a screen of widgets.
   */
  children?: ReactNode;
}

/**
 * The Dashboard panel of a gg run: everything about the run *as a whole* rather
 * than about one of its agents — its status, the turns and generation rate behind it, the
 * running token and cost tallies with their caching/reasoning/cost splits, an overview of
 * the agents that ran, the configuration it ran under, and the enforced FSM process when a
 * machine drives it.
 *
 * The agent overview is a row per agent (its peak context, its token share, and the
 * tools it used), each a link into that agent's files in the Instances explorer — so
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
 * Under the top row the run's errors take a row of their own — how many turns failed, the
 * worst any one agent clustered them, and which specific types they were (see
 * {@link ErrorsRow}) — and under that the run's clocks take another, one tile each for the
 * wall clock, the active agent time, the waiting, and the ceiling (see {@link RuntimeRow}).
 * Both were single tiles with their sub-facts crammed under one headline, which read as
 * footnotes to whichever figure won the big slot rather than as the independent facts they
 * are; given a row, each gets a headline and a sentence saying what it counts.
 *
 * Both surfaces get the *same* layout: the one difference is the status card, which a
 * finished run omits because the run detail page's own header already carries its state
 * (the turn count and the generation rate then split that row between them, rather than
 * reflowing everything below it).
 */
export function GgDashboard({
  status,
  usage,
  slotUsage,
  perAgent,
  agentForest,
  capabilitySet,
  runtime,
  timeoutSeconds,
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

  // How fast the run generates: each agent's tokens over the time it spent inside its
  // model calls, folded onto the models that did the generating.
  const throughput = useGgThroughput(agentForest, perAgent);

  // The run's total turns across every agent — one per `turn_started`, summed over the
  // per-agent partitions (each turn is stamped with exactly one agent, so the sum is
  // the whole-run count). A session-level figure, so it reads at the top of the
  // Dashboard beside the status rather than inside the agents card.
  const totalTurns = useMemo(
    () =>
      [...perAgent.values()].reduce((sum, state) => sum + state.turnCount, 0),
    [perAgent],
  );

  // How those turns went, summed the same way — every agent's own error record folded
  // into the run's. Summed off the per-agent slices rather than folded off the merged
  // stream so the consecutive-error peak is the worst any ONE agent reached, which is
  // the counter gg's own ceiling is enforced on; a streak counted across a parallel
  // run's interleaved turns would be an artefact of scheduling.
  const errors = useMemo(() => {
    const total = emptyErrorTally();
    for (const state of perAgent.values()) addErrorTally(total, state.errors);
    return total;
  }, [perAgent]);

  // The bento span the top row's tiles take — the status card's included, so the row is
  // sized in one place rather than by a card deciding its own width. The row is three tiles
  // beside the status card and two without it, so it fills twelve either way: thirds where
  // the status card leads (4 + 4 + 4), halves where the page header carries the state
  // instead (6 + 6). Neither the runtime figures nor the error record are in this row any
  // more; each has one of its own below it.
  const statSpan = status ? styles.cardThird : styles.cardHalf;

  return (
    <div className={styles.dashboard}>
      {/* The run's own notices — its terminal outcome, a stream error, the replay link —
          lead the panel, directly under the tab selector and above the read-out they are
          about. Trailing the cards, "run complete" landed a screen below the fold on the
          very surface a reader is watching to learn exactly that. */}
      {children}

      <div className={styles.cards}>
        {/* The top row: where the run is at — its phase, how many turns it has spent, and
            how fast it is generating. The live monitor leads the row with the status card; a
            finished run's gg tab has its state in the page's own header, so the two stat
            tiles widen to split that row between them rather than leaving a hole where the
            status card would have been — the rows below it are then identical on both
            surfaces. How the run's turns went, and how long it has been going, are the two
            rows underneath: each is several figures rather than one and so earns its own. */}
        {status && <StatusCard status={status} className={statSpan} />}
        <TurnsCard
          turns={totalTurns}
          agents={perAgent.size}
          className={statSpan}
        />
        <ThroughputCard throughput={throughput} className={statSpan} />

        {/* The error row, directly under the turn count it is read against — a count of
            failures is meaningless without the count of attempts, which is why the total
            still carries its own denominator on its face rather than relying on the
            adjacency alone. */}
        <ErrorsRow errors={errors} />

        {/* The clocks row, laid out as its own block for the reason the money row below
            is: its four tiles are fixed here rather than wherever the bento's dense
            auto-placement would pack them, so the row reads identically whether or not a
            status card precedes it. */}
        <RuntimeRow runtime={runtime} timeoutSeconds={timeoutSeconds} />

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
// across every agent. It sits on the top row with the status and the generation rate — how
// much the run has done, and how fast it is doing it — each taking a third of the row. Where
// there is no status card (a finished run, whose state its page header already carries) the
// two stat tiles widen to a half each rather than leaving the row short.
function TurnsCard({
  turns,
  agents,
  className,
}: {
  turns: number;
  agents: number;
  /** The bento span the card takes: a third beside a status card, a half without one. */
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

// How many error types the ranking names before it stops. Three, because the point of a
// ranking is the narrowing: gg's taxonomy has nineteen specific types, and a run whose
// failures do not concentrate into a few of them is telling you that on its face.
const TOP_ERROR_TYPES_SHOWN = 3;

// The error row: how many of the run's turns failed, how hard they clustered, and which
// specific types they were — one tile each.
//
// Three tiles rather than one, for the reason the clocks row is four: these are three
// independent facts and not a headline with footnotes. They *were* one Errors card, at a
// quarter of the top row, with the consecutive-error peak reduced to a clause on the rate's
// line and the split reduced to two-cell rows that a quarter-row tile could just about hold.
// The peak is the counter gg's own ceiling is enforced on — the figure that says whether a
// run was failing steadily or falling over — and it read as a footnote to a percentage; and
// the split, now that gg types every error specifically, is a ranking rather than a five-row
// list and needs the width to be one.
//
// The ranking takes the row's wide share (see `.errorsBlock`) because its rows carry a
// sentence-length label, a base-kind badge and a count, where the two scalar tiles carry a
// figure and a phrase. Splitting the row evenly would either wrap every type label or waste
// two thirds of the row on two numbers.
//
// gg already *judges* every turn, since that judgement is what its error ceilings are
// enforced on; this row is that judgement kept rather than thrown away the moment an agent's
// loop ended, which is what used to make a run that failed a third of its turns and finished
// anyway indistinguishable from one that never failed a turn.
function ErrorsRow({ errors }: { errors: GgErrorTally }) {
  const { turns, errors: failed, maxConsecutive, loopAborts } = errors;
  // The ranking is over the SPECIFIC types (`byType`), not the five base kinds: "top error
  // types" over five buckets is barely a narrowing, and the base each type rolls up into
  // rides along on every row as a badge, so nothing the per-kind split said is lost.
  const top = topErrorTypes(errors, TOP_ERROR_TYPES_SHOWN);
  return (
    <div className={styles.errorsBlock}>
      {/* The headline is the error COUNT rather than the rate: a rate is a derived figure,
          and putting it in the tile's big slot invites reading "0%" on a run that has taken
          two turns as though it meant something. The rate is on the line under it, beside
          the denominator it was taken against, so the two can never be read apart — 50% of
          two turns and 50% of two hundred are not the same claim about a configuration. A
          stream with no outcomes on it at all (a run recorded before gg published them, or
          one that has not finished its first turn) says so rather than claiming a clean
          record. */}
      <div
        className={styles.card}
        title="Errored turns across every agent in the run, against the turns that reported an outcome at all"
      >
        <span className={styles.cardLabel}>Total errors</span>
        <span className={styles.metricValue}>
          {turns === 0 ? "—" : numberFmt.format(failed)}
        </span>
        <span className={styles.metricUnit}>
          {turns === 0
            ? "no turn outcomes reported yet"
            : failed === 0
              ? `no errored turns of ${numberFmt.format(turns)}`
              : `${formatPercent(failed / turns)} of ${numberFmt.format(turns)} turns`}
        </span>
        {/* Not an error — the retry succeeded — but money and wall-clock spent on nothing,
            which is the figure that says whether arming loop detection paid for itself.
            Absent on every run that left it disarmed, which is the default. */}
        {loopAborts > 0 && (
          <span className={styles.metricUnit}>
            {numberFmt.format(loopAborts)} looping{" "}
            {loopAborts === 1 ? "reply" : "replies"} discarded
          </span>
        )}
      </div>

      {/* A peak over agents, not a streak across the run: turns from concurrent agents
          interleave arbitrarily, so a streak counted off the merged stream would be an
          artefact of scheduling rather than a fact about any agent (see
          `GgErrorTally.maxConsecutive`). It is stated because it is the exact counter gg's
          consecutive-error ceiling is enforced on — a run reading "2 of 40 turns" is a
          different animal depending on whether those two were adjacent. */}
      <div
        className={styles.card}
        title="The longest unbroken run of errored turns any single agent reached — the counter gg's consecutive-error ceiling is enforced on. A peak over agents, not a streak across the whole run, whose turns interleave."
      >
        <span className={styles.cardLabel}>Max consecutive errors</span>
        <span className={styles.metricValue}>
          {turns === 0 ? "—" : numberFmt.format(maxConsecutive)}
        </span>
        <span className={styles.metricUnit}>
          {turns === 0
            ? "no turn outcomes reported yet"
            : failed === 0
              ? "no turn errored"
              : "in a row at worst, by one agent"}
        </span>
      </div>

      <div className={`${styles.card} ${styles.errorsRanking}`}>
        <span className={styles.cardLabel}>Top error types</span>
        {top.length > 0 ? (
          <ul className={styles.errorTypes}>
            {top.map((row) => (
              <ErrorTypeRow key={row.id} row={row} />
            ))}
          </ul>
        ) : (
          // Three distinct nothings, and conflating them would each time claim something
          // the run does not say. No outcomes at all is not evidence of a clean run; a
          // clean run is not a run whose types went unrecorded; and a run recorded before
          // gg typed its errors has errors this console cannot rank — rendering that as
          // "no errors" would report the opposite of what happened.
          <span className={styles.metricUnit}>
            {turns === 0
              ? "no turn outcomes reported yet"
              : failed === 0
                ? "no errors to rank"
                : "not recorded — this run predates per-type errors"}
          </span>
        )}
      </div>
    </div>
  );
}

// One row of the ranking: what failed, which base bucket it belongs to, and how often.
//
// The base kind rides as a badge because a specific type does not always name its own
// family — "syntax error" and "unknown name" say nothing about being a transpile failure
// and a program fault respectively, and that grouping is what the five error ceilings are
// written against. It is withheld where it would only repeat the label beside it (a base
// with a single type shares its wording), since a badge that restates its row is noise, and
// on a type from a newer gg than this console, which has no base to claim.
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

// The run's generation rate: the tokens its models produced per second of the time it
// spent inside their calls, across every model it used (see `ggThroughput`). It joins the
// status and the turn count on the top row as the third answer to "where is this run at" —
// the two counts say how much a run has done and spent, and neither says whether the
// wall-clock behind them (the row below) went into generating or into waiting.
//
// One figure, because it is the run's average: the models that make it up are named in the
// card's tooltip on a multi-model run, where an average is a blend of rates rather than a
// property of the run.
function ThroughputCard({
  throughput,
  className,
}: {
  throughput: GgThroughput;
  /** The bento span the card takes — see {@link TurnsCard}. */
  className: string | undefined;
}) {
  const { overall, perModel } = throughput;
  return (
    <div
      className={`${styles.card} ${className}`}
      title={
        perModel.length > 1
          ? perModel
              .map(
                (model) =>
                  `${model.modelName}: ${formatThroughput(model.tokensPerSecond)}`,
              )
              .join("\n")
          : undefined
      }
    >
      <span className={styles.cardLabel}>Tokens / s</span>
      <span className={styles.metricValue}>
        {overall == null ? "—" : formatThroughputValue(overall)}
      </span>
      <span className={styles.metricUnit}>
        {overall == null
          ? "no timed model calls yet"
          : perModel.length === 0
            ? "tok/s generated"
            : `tok/s across ${perModel.length} ${
                perModel.length === 1 ? "model" : "models"
              }`}
      </span>
    </div>
  );
}

// How many agents are in a given state, as the sentence that hangs under a duration: "3
// agents working", "1 agent waiting", "none working". Spelled out rather than left as a bare
// figure because these tiles pair a *count* with a *clock*, and "3" under "12m 04s" reads as
// part of the measurement; the verb is what makes it a separate fact. Zero reads "none"
// rather than "0 agents" — a run with nobody working is a state, not a quantity, and the
// word is what a reader glancing at a stalled run actually registers.
function agentPhrase(count: number, verb: string): string {
  if (count === 0) return `none ${verb}`;
  return `${count} ${count === 1 ? "agent" : "agents"} ${verb}`;
}

// The clocks row: the wall clock, the agent time it bought, the waiting it did not, and the
// ceiling the host stops the run at — one tile each.
//
// Four tiles rather than one, because these are four independent facts and not a headline
// with footnotes. They were a single Runtime card: the wall clock as its figure with the
// other three crammed under it as unit-sized lines, which made the summed agent time — the
// figure that says whether the configuration's parallelism did anything — read as an
// annotation of the wall clock rather than as the thing it is measured *against*. Given a
// row, each duration gets a headline at the same weight as its neighbours and a sentence
// saying what it counts.
//
// Why both clocks are shown at all (see `ggRuntime`): the wall clock covers exactly the span
// the timeout does (setup excluded), while the sum is the work the run actually got done
// inside it — a run that fans four agents out spends four minutes of agent time per wall
// minute, and the gap between the figures is the parallelism the configuration bought. Both
// count up live, so the row is a clock rather than a snapshot of whenever the newest event
// landed.
//
// Active and Waiting are the two halves of that sum: an agent blocked on its children or on
// a board issue is not working, so its wait is subtracted from the active total and given a
// tile of its own rather than folded in — a delegating run whose parents mostly wait would
// otherwise report several times the work it did. Each pairs its duration with the
// *instantaneous* count of agents in that state, which is what makes a live run legible: a
// run reading "none working / 4 agents waiting" is stalled on something, and no accumulated
// total says that until minutes after the fact. Those two counts speak only while the run is
// executing — before and after, they read "none" whatever the last statuses on the stream
// said, since they are claims about a present the run no longer has (see `ggRuntime`).
function RuntimeRow({
  runtime,
  timeoutSeconds,
}: {
  runtime: GgRuntime;
  timeoutSeconds: number | null;
}) {
  const {
    wallMs,
    agentMs,
    suspendedMs,
    agentCount,
    activeAgents,
    waitingAgents,
    parallelism,
  } = runtime;
  return (
    <div className={styles.runtimeBlock}>
      {/* The ratio between the two clocks is the one fact none of the four tiles states on
          its face — it is a division of one by another — so it rides as the wall clock's
          tooltip, on the tile that is the denominator. */}
      <div
        className={styles.card}
        title={
          parallelism != null
            ? `${formatRuntime(agentMs)} of active agent time in ${formatRuntime(
                wallMs ?? 0,
              )} of wall clock — ${parallelism.toFixed(
                1,
              )} agents working at once on average`
            : undefined
        }
      >
        <span className={styles.cardLabel}>Runtime</span>
        <span className={styles.metricValue}>
          {wallMs == null ? "—" : formatRuntime(wallMs)}
        </span>
        <span className={styles.metricUnit}>
          {wallMs == null ? "not running yet" : "wall clock"}
        </span>
      </div>

      {/* The count under the sum is how many agents are working *now*, which is emphatically
          not how many contributed to the sum — a finished run has hours of agent time and
          nobody working. The tooltip is where that distinction is spelled out, since the tile
          has room for one sentence and the live count is the one worth reading. It is
          withheld where nothing has contributed a runtime yet — a stream with nothing in it,
          or a run still in setup, whose figures `ggRuntime` measures over an execution it has
          not reached — since there is then no total for the sentence to be about. */}
      <div
        className={styles.card}
        title={
          agentCount > 0
            ? `Summed across the ${agentCount} ${
                agentCount === 1 ? "agent" : "agents"
              } that have run — the count beneath is how many are working right now, not how many contributed to the total`
            : undefined
        }
      >
        <span className={styles.cardLabel}>Active</span>
        <span className={styles.metricValue}>{formatRuntime(agentMs)}</span>
        <span className={styles.metricUnit}>
          {agentPhrase(activeAgents, "working")}
        </span>
      </div>

      <div
        className={styles.card}
        title="Time agents spent suspended rather than working — waiting on the subagents they fanned out, or on a board issue"
      >
        <span className={styles.cardLabel}>Waiting</span>
        <span className={styles.metricValue}>{formatRuntime(suspendedMs)}</span>
        <span className={styles.metricUnit}>
          {agentPhrase(waitingAgents, "waiting")}
        </span>
      </div>

      {/* Stated even where nothing resolved one. The tile holds its place in the row rather
          than collapsing it to three — and "no limit resolved" is a positive statement that
          the catalog could not be reached, which an absent tile would leave a reader to
          mistake for a run that simply has no ceiling. */}
      <div
        className={styles.card}
        title="The test case's own max_runtime_hours — the ceiling the host stops the run at, measured against the wall clock beside it (setup excluded)"
      >
        <span className={styles.cardLabel}>Time limit</span>
        <span className={styles.metricValue}>
          {timeoutSeconds == null ? "—" : formatLimit(timeoutSeconds)}
        </span>
        <span className={styles.metricUnit}>
          {timeoutSeconds == null ? "no limit resolved" : "wall-clock ceiling"}
        </span>
      </div>
    </div>
  );
}

function StatusCard({
  status,
  className,
}: {
  status: GgDashboardStatus;
  /** The bento span the card takes — see {@link TurnsCard}. Sized by the row, not here. */
  className: string | undefined;
}) {
  const toneClass =
    status.tone === "ok"
      ? styles.pillOk
      : status.tone === "fail"
        ? styles.pillFail
        : status.tone === "stopped"
          ? styles.pillStopped
          : styles.pillLive;
  return (
    // One tile of the top row, not all of it: the turn count, the error count and the
    // generation rate take the rest, and the row hands every tile its span (see
    // `statSpan`). The kill control rides on the label's row at the card's trailing edge
    // rather than in the line below: at a quarter of the row it wrapped under the pill,
    // which both cost a row and moved the control depending on how long the phase's detail
    // ran. Level with "Status" it is always in the same corner, and the pill and its detail
    // get the full line back — which is what lets this card take a quarter again.
    <div className={`${styles.card} ${className}`}>
      <div className={styles.cardHeader}>
        <span className={styles.cardLabel}>Status</span>
        {/* Rendered only when the host supplies one — a finished run has nothing to kill,
            and an empty span would leave the header a control's height taller than the
            label it holds. */}
        {status.action && (
          <span className={styles.statusAction}>{status.action}</span>
        )}
      </div>
      <div className={styles.statusLine}>
        <span className={`${styles.pill} ${toneClass}`}>{status.label}</span>
        {status.detail && (
          <span className={styles.statusDetail}>{status.detail}</span>
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
    // No bento span: the money row places this card in the column beside Cost, not in the
    // dashboard grid, so its width is that column's.
    <div className={styles.card}>
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
                <span className={styles.slotModel}>{agent.modelId}</span>
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
