import { useEffect, useId, useMemo, useState } from "react";
import { SegmentedControl, type SegmentedOption } from "@test-cabinet/ui";
import type {
  GgAgentStatus,
  GgCapabilitySet,
} from "@test-cabinet/run-record/gg";
import dash from "./GgDashboard.module.scss";
import styles from "./GgAgentsSummary.module.scss";
import { useGgAgentSummaries, type GgAgentSummary } from "./ggAgentAggregate";
import type { GgAttributionRow } from "./ggContextAttribution";
import type { AgentTreeNode, DerivedGgState } from "./useGgRunState";
import { callRatePhrase, shortTokens } from "./useGgRunState";
import {
  CostWidget,
  TokensWidget,
  formatCost,
  formatPercent,
} from "./GgOverviewWidgets";
import { useGgExplorerNav } from "./GgExplorerNav";

// The Agents tab: a gg run read **per configured agent** rather than per instance.
//
// The Instances explorer answers "what did agent-7 do". This answers the question you
// actually tune a configuration on: *what is each agent in this configuration worth?* A
// profile that spawns twelve instances is one arm of the experiment, not twelve, so its
// instances are summed into one read-out — how many of it ran, what they spent between them,
// how full their windows got, and (the part no other view has) **which material filled those
// windows**: the files and tool output the run paid to carry, turn after turn.
//
// The layout is one **collapsible row per agent**, all closed to begin with. The first
// question here is comparative — which agent is eating the run — and rows answer that where a
// stack of open cards does not: closed, the panel is a short aligned list you can read down a
// column of, each row carrying the same figures a comparison table would have (instances,
// turns, tokens, cost, peak context, each with its share of the run). Opening a row is asking
// the second question, of one agent at a time, and it is the only place the detail appears —
// so the basics are stated once rather than once in a table and again in a card below it.

const numberFmt = new Intl.NumberFormat("en-US");

// The call-rate figure is the one reading on this panel whose *meaning* is not obvious from
// its label, so it explains itself on hover in both places it appears — the closed row's
// comparison line and the open detail's stat grid — rather than only where there is room.
function callRateTitle(agent: GgAgentSummary): string {
  return (
    "Tool and function calls per assistant response — " +
    `${callRatePhrase(agent.tools.totalCalls, agent.turns)}, ` +
    "summed over every instance of this agent. " +
    "A proxy for efficiency: an agent that does more per round trip spends fewer responses, " +
    "less latency, and less context reaching the same place."
  );
}

/** How many rows a context breakdown shows before the rest fold behind a "show all". */
const ATTRIBUTION_ROWS_SHOWN = 8;

/** How the three readings of an agent's window are labelled. */
type AttributionView = "files" | "tools" | "sources";

const ATTRIBUTION_VIEWS: ReadonlyArray<SegmentedOption<AttributionView>> = [
  { value: "files", label: "Files" },
  { value: "tools", label: "Tools" },
  { value: "sources", label: "Sources" },
];

interface GgAgentsSummaryProps {
  /** The run's configuration — the agents it declares are the rows, in its own order. */
  capabilitySet: GgCapabilitySet | null;
  /** The delegation forest, whose nodes are the instances grouped under those agents. */
  agentForest: AgentTreeNode[];
  /** Each instance's own reduced slice, keyed by agent id. */
  perAgent: Map<string, DerivedGgState>;
  /**
   * A configured agent to open, set when another surface links here — a module holder's
   * profile chip on the Modules tab, which asks "is this how that arm is configured?".
   * Every row starts closed, so the request is honored by opening that one. A one-shot
   * request the panel clears through `onFocusHandled` once it has.
   */
  focusProfile?: string | null;
  onFocusHandled?: () => void;
}

/**
 * The Agents panel — every agent the run's configuration defines, with its instances summed
 * into one read-out.
 *
 * The fold happens here rather than in the host panels so it costs nothing while the tab is
 * closed: attributing a window's spend walks every instance's whole message log, which on a
 * long run is real work to redo each time a live event lands.
 */
export function GgAgentsSummary({
  capabilitySet,
  agentForest,
  perAgent,
  focusProfile,
  onFocusHandled,
}: GgAgentsSummaryProps) {
  const summaries = useGgAgentSummaries(capabilitySet, agentForest, perAgent);
  // Which rows are open, by agent name. Everything starts closed — the panel's first job is
  // the comparison across agents, and a run with five profiles opened by default would bury
  // it under five screens of detail — so the set holds only what the reader has opened.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const toggle = (name: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  // Honor a jump-to-agent request from elsewhere in the panels: open that agent's row —
  // everything here starts closed, so arriving with the row still shut would answer the
  // question the link was asked with a list. Guarded on the agent being one this panel
  // knows, so a request naming a profile the run never announced is simply ignored.
  useEffect(() => {
    if (focusProfile == null) return;
    if (summaries.some((agent) => agent.name === focusProfile)) {
      setExpanded((prev) => new Set(prev).add(focusProfile));
    }
    onFocusHandled?.();
  }, [focusProfile, summaries, onFocusHandled]);

  if (summaries.length === 0) {
    return (
      <p className={styles.empty}>
        No agents yet — the run has not announced its configuration.
      </p>
    );
  }

  // The denominators a row's shares are read against: the agents' own totals, so the shares
  // partition the run exactly — the same reasoning the Dashboard's per-agent token share uses.
  const totalTokens = summaries.reduce(
    (sum, agent) => sum + agent.usage.totalTokens,
    0,
  );
  const totalCost = summaries.reduce(
    (sum, agent) => sum + (agent.cost?.total ?? 0),
    0,
  );

  return (
    <div className={`${dash.card} ${styles.summary}`}>
      <span className={dash.cardLabel}>Agents · {summaries.length}</span>
      <ul className={styles.agentList}>
        {summaries.map((agent) => (
          <AgentRow
            key={agent.name}
            agent={agent}
            totalTokens={totalTokens}
            totalCost={totalCost}
            open={expanded.has(agent.name)}
            onToggle={() => toggle(agent.name)}
          />
        ))}
      </ul>
    </div>
  );
}

// One agent as a collapsible row: the basics on the row itself, the whole read-out behind it.
//
// Closed, the row is the comparison line — instances, turns, tokens, cost, peak context, each
// with its share of the run — so a reader scans a column down the list without opening
// anything. Each figure carries its own label rather than relying on a header, which is what
// lets the row wrap on a narrow pane instead of scrolling sideways away from its own headings.
function AgentRow({
  agent,
  totalTokens,
  totalCost,
  open,
  onToggle,
}: {
  agent: GgAgentSummary;
  totalTokens: number;
  totalCost: number;
  open: boolean;
  onToggle: () => void;
}) {
  // A generated id rather than one built from the agent's name: a profile name is
  // operator-authored and may hold spaces, which an `aria-controls` IDREF cannot.
  const detailId = useId();
  const ran = agent.instances.length > 0;
  return (
    <li className={styles.agentRow}>
      <button
        type="button"
        className={styles.agentSummary}
        aria-expanded={open}
        // Only while the region exists — a control pointing at an absent id is a broken
        // reference, not an empty one.
        aria-controls={open ? detailId : undefined}
        onClick={onToggle}
      >
        <span className={styles.caret} aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        {/* The agent's name and what it is, then the model it is bound to on its own line
            beneath — the model annotates the agent rather than standing beside it, and on
            one line it crowded the badges and pushed long ids into the figures. */}
        <span className={styles.rowIdentity}>
          <span className={styles.rowNameLine}>
            <span className={styles.rowName}>{agent.name}</span>
            {agent.root && <span className={dash.capability}>root</span>}
            {!agent.declared && (
              <span
                className={dash.capability}
                title="seen on the stream, not in the run's configuration"
              >
                undeclared
              </span>
            )}
          </span>
          {agent.modelName && (
            <span className={styles.rowModel}>{agent.modelName}</span>
          )}
        </span>
        <span className={styles.figures}>
          <Figure
            label="instances"
            value={ran ? numberFmt.format(agent.instances.length) : "none"}
            sub={ran ? undefined : "never ran"}
            muted={!ran}
          />
          <Figure label="turns" value={numberFmt.format(agent.turns)} />
          <Figure
            label="tokens"
            value={
              agent.usage.anyTokens ? shortTokens(agent.usage.totalTokens) : "—"
            }
            sub={
              agent.usage.anyTokens && totalTokens > 0
                ? formatPercent(agent.usage.totalTokens / totalTokens)
                : undefined
            }
          />
          <Figure
            label="cost"
            value={agent.cost ? formatCost(agent.cost.total) : "—"}
            sub={
              agent.cost && totalCost > 0
                ? formatPercent(agent.cost.total / totalCost)
                : undefined
            }
          />
          <Figure
            label="peak context"
            value={
              agent.peakFullness != null
                ? formatPercent(agent.peakFullness)
                : agent.peakTokens > 0
                  ? shortTokens(agent.peakTokens)
                  : "—"
            }
            // The worst instance leads; the mean sits under it where more than one ran, since
            // a single reviewer that filled its window is a different problem from every
            // reviewer doing so.
            sub={
              agent.instances.length > 1 && agent.meanPeakFullness != null
                ? `${formatPercent(agent.meanPeakFullness)} avg`
                : undefined
            }
          />
          <Figure
            label="calls/resp"
            value={
              agent.toolCallsPerResponse != null
                ? agent.toolCallsPerResponse.toFixed(1)
                : "—"
            }
            title={callRateTitle(agent)}
          />
        </span>
      </button>
      {open && (
        <div
          id={detailId}
          className={styles.agentDetail}
          role="region"
          aria-label={`${agent.name} detail`}
        >
          <AgentDetail agent={agent} />
        </div>
      )}
    </li>
  );
}

// One figure on a closed row: the number over what it counts, so the row needs no header and
// stays readable however it wraps.
function Figure({
  label,
  value,
  sub,
  muted = false,
  title,
}: {
  label: string;
  value: string;
  sub?: string;
  muted?: boolean;
  /** Hover text for a figure whose label cannot say what it measures on its own. */
  title?: string;
}) {
  return (
    <span className={styles.figure} title={title}>
      <span className={muted ? styles.figureValueMuted : styles.figureValue}>
        {value}
      </span>
      <span className={styles.figureLabel}>{label}</span>
      {sub && <span className={styles.figureSub}>{sub}</span>}
    </span>
  );
}

// One agent in full, behind its row: what it is configured as, what its instances spent, and
// what filled their windows.
function AgentDetail({ agent }: { agent: GgAgentSummary }) {
  const ran = agent.instances.length > 0;
  return (
    <>
      {(agent.capabilities.length > 0 || agent.disabledTools.length > 0) && (
        <div className={styles.capabilities}>
          {agent.capabilities.map((id) => (
            <span key={id} className={dash.capability}>
              {id}
            </span>
          ))}
          {agent.disabledTools.map((tool) => (
            <span
              key={`-${tool}`}
              className={styles.disabledTool}
              title="withheld from this agent even though its capability is on"
            >
              −{tool}
            </span>
          ))}
        </div>
      )}

      {ran ? (
        <>
          <InstanceChips agent={agent} />
          <AgentStats agent={agent} />
          {/* The same Tokens and Cost widgets the Dashboard and an instance's Overview
              use, fed this agent's summed usage — so a profile's spend reads in the shape
              a run's spend does, rather than as a differently-shaped summary. Stacked at
              the detail's full width rather than side by side: each carries a rate, two
              composition rings, or a class split, and halving the column squeezed all of
              that into a pair of narrow towers. */}
          <div className={styles.widgetStack}>
            <TokensWidget
              usage={agent.usage}
              throughput={agent.tokensPerSecond}
              bare
              wide
            />
            <CostWidget usage={agent.usage} breakdown={agent.cost} bare />
          </div>
          <ContextBreakdown agent={agent} />
          <ToolsSection agent={agent} />
        </>
      ) : (
        /* A configured arm the run never exercised — which is a result, not a gap. */
        <p className={styles.never}>
          The configuration declares this agent, but the run never spawned one.
        </p>
      )}
    </>
  );
}

// The instances themselves, each a chip that opens it in the Instances explorer — the way
// back from "this profile is expensive" to "which of its instances was".
function InstanceChips({ agent }: { agent: GgAgentSummary }) {
  const nav = useGgExplorerNav();
  if (agent.instances.length === 0) return null;
  return (
    <ul className={styles.instances}>
      {agent.instances.map((instance) => {
        const label = `${instance.id} · ${instance.turns} turn${instance.turns === 1 ? "" : "s"}`;
        const inner = (
          <>
            <span
              className={dash.agentDot}
              data-status={instance.status}
              aria-hidden="true"
            />
            <span className={styles.instanceName}>{instance.id}</span>
            <span className={styles.instanceMeta}>
              {shortTokens(instance.tokens)}
            </span>
          </>
        );
        return (
          <li key={instance.id}>
            {nav ? (
              <button
                type="button"
                className={styles.instanceChip}
                onClick={() => nav.openAgent(instance.id)}
                aria-label={`Open ${label}`}
                title={label}
              >
                {inner}
              </button>
            ) : (
              <span className={styles.instanceChip} title={label}>
                {inner}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// The figures that only mean something once the instances are summed: how many ran and how
// they ended, what a typical one cost, and how hard they leaned on the window.
function AgentStats({ agent }: { agent: GgAgentSummary }) {
  const count = agent.instances.length;
  const costEach = agent.cost ? agent.cost.total / count : null;
  return (
    <div className={styles.stats}>
      <Stat
        label="instances"
        value={numberFmt.format(count)}
        sub={statusSummary(agent.statusCounts)}
      />
      <Stat
        label="turns"
        value={numberFmt.format(agent.turns)}
        sub={`${(agent.turns / count).toFixed(1)} per instance`}
      />
      <Stat
        label="cost each"
        value={costEach != null ? formatCost(costEach) : "—"}
        sub={agent.cost ? `${formatCost(agent.cost.total)} total` : undefined}
      />
      <Stat
        label="tokens each"
        value={shortTokens(Math.round(agent.usage.totalTokens / count))}
        sub={`${shortTokens(agent.usage.totalTokens)} total`}
      />
      <Stat
        label="peak context"
        value={
          agent.peakFullness != null
            ? formatPercent(agent.peakFullness)
            : agent.peakTokens > 0
              ? shortTokens(agent.peakTokens)
              : "—"
        }
        sub={
          agent.meanPeakFullness != null && count > 1
            ? `${formatPercent(agent.meanPeakFullness)} typical`
            : undefined
        }
      />
      <Stat
        label="compactions"
        value={numberFmt.format(agent.compactions)}
        sub={
          agent.compactions > 0
            ? `${(agent.compactions / count).toFixed(1)} per instance`
            : "window never reclaimed"
        }
      />
      {/* The profile's calls over the profile's responses, not the mean of its instances'
          own rates — see `GgAgentSummary.toolCallsPerResponse` for why. The sub says both
          halves so the ratio can be checked against the numbers it came from. */}
      <Stat
        label="calls per response"
        value={
          agent.toolCallsPerResponse != null
            ? agent.toolCallsPerResponse.toFixed(1)
            : "—"
        }
        sub={`${numberFmt.format(agent.tools.totalCalls)} calls · ${numberFmt.format(agent.turns)} responses`}
        title={callRateTitle(agent)}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  title,
}: {
  label: string;
  value: string;
  sub?: string;
  /** Hover text for a stat whose label cannot say what it measures on its own. */
  title?: string;
}) {
  return (
    <div className={dash.stat} title={title}>
      <span className={dash.statValue}>{value}</span>
      <span className={dash.statLabel}>{label}</span>
      {sub && <span className={dash.statSub}>{sub}</span>}
    </div>
  );
}

// How an agent's instances ended, as a short phrase — "3 done · 1 failed" — so the instance
// count carries its outcome rather than needing to be counted off the chips.
function statusSummary(counts: Record<GgAgentStatus, number>): string {
  const parts = (["running", "blocked", "done", "failed"] as const)
    .filter((status) => counts[status] > 0)
    .map((status) => `${counts[status]} ${status}`);
  return parts.join(" · ");
}

// What filled this agent's windows, and what carrying it cost. The three readings of one
// accounting — by file, by tool, by band — behind a selector, since they answer the same
// question at different grains and stacking all three would bury the one being read.
function ContextBreakdown({ agent }: { agent: GgAgentSummary }) {
  const [view, setView] = useState<AttributionView>("files");
  const { context } = agent;
  const rows =
    view === "files"
      ? context.byFile
      : view === "tools"
        ? context.byTool
        : context.bySource;

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={dash.cardLabel}>Context spend</span>
        <SegmentedControl
          options={ATTRIBUTION_VIEWS}
          value={view}
          onChange={setView}
          ariaLabel="context breakdown"
        />
      </div>
      {!context.known ? (
        <p className={styles.empty}>
          No message log was recorded for this agent.
        </p>
      ) : rows.length === 0 ? (
        <p className={styles.empty}>
          Nothing in this agent's window came from {view}.
        </p>
      ) : (
        <AttributionList rows={rows} total={context.billedTokens} />
      )}
      {view === "files" && context.unattributedFileTokens > 0 && (
        <p className={styles.sectionNote}>
          {shortTokens(Math.round(context.unattributedFileTokens))} of file
          views could not be traced to a path — a view carried across a
          compaction on a stream recorded before gg tagged it.
        </p>
      )}
    </section>
  );
}

// The bars themselves: each thing the window carried, its share of the agent's billed input,
// and what that share cost. Long lists fold after the leaders, since the tail of a file list
// is a hundred one-turn reads nobody is tuning against.
function AttributionList({
  rows,
  total,
}: {
  rows: GgAttributionRow[];
  total: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = useMemo(
    () => (expanded ? rows : rows.slice(0, ATTRIBUTION_ROWS_SHOWN)),
    [rows, expanded],
  );
  // Bars are scaled to the leader, not to the total: a window's spend is spread over
  // hundreds of messages, so scaling to the whole would leave every bar a sliver.
  const leader = rows[0]?.billedTokens ?? 0;

  return (
    <>
      <ul className={styles.attrList}>
        {shown.map((row) => (
          <li key={row.key} className={styles.attrRow}>
            <span className={styles.attrIdentity}>
              <span className={styles.attrName} title={row.label}>
                {row.label}
              </span>
              <span className={styles.attrMeta}>
                {shortTokens(row.tokens)} · {row.messages}× · resident{" "}
                {row.turns} turn{row.turns === 1 ? "" : "s"}
              </span>
            </span>
            <span className={styles.attrBar} aria-hidden="true">
              <span
                className={styles.attrBarFill}
                style={{
                  width: `${leader > 0 ? (row.billedTokens / leader) * 100 : 0}%`,
                }}
              />
            </span>
            <span className={styles.attrFigures}>
              <span className={styles.attrValue}>
                {row.cost != null
                  ? formatCost(row.cost)
                  : shortTokens(Math.round(row.billedTokens))}
              </span>
              <span className={styles.attrShare}>
                {formatPercent(total > 0 ? row.billedTokens / total : 0)}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {rows.length > ATTRIBUTION_ROWS_SHOWN && (
        <button
          type="button"
          className={styles.moreButton}
          onClick={() => setExpanded((on) => !on)}
        >
          {expanded
            ? "Show fewer"
            : `Show all ${numberFmt.format(rows.length)}`}
        </button>
      )}
    </>
  );
}

// Every tool this agent's instances called, summed — the itemized version of the Dashboard
// row's chips, but per profile rather than per instance, so "the reviewer reads forty files
// per review" is a thing you can see.
function ToolsSection({ agent }: { agent: GgAgentSummary }) {
  const { tools, totalCalls, outputTokensKnown, totalContextTokens } =
    agent.tools;
  if (tools.length === 0) return null;
  return (
    <section className={styles.section}>
      <span className={dash.cardLabel}>
        Tools · {numberFmt.format(totalCalls)} calls
      </span>
      <ul className={styles.attrList}>
        {tools.map((tool) => {
          const share =
            outputTokensKnown && totalContextTokens > 0
              ? tool.outputTokens / totalContextTokens
              : null;
          return (
            <li key={tool.name} className={styles.attrRow}>
              <span className={styles.attrIdentity}>
                <span className={styles.attrName}>{tool.name}</span>
                <span className={styles.attrMeta}>
                  {(tool.calls / agent.instances.length).toFixed(1)} per
                  instance
                </span>
              </span>
              <span className={styles.attrBar} aria-hidden="true">
                <span
                  className={styles.attrBarFill}
                  style={{
                    width: `${totalCalls > 0 ? (tool.calls / totalCalls) * 100 : 0}%`,
                  }}
                />
              </span>
              <span className={styles.attrFigures}>
                <span className={styles.attrValue}>{tool.calls}×</span>
                <span className={styles.attrShare}>
                  {share != null ? shortTokens(tool.outputTokens) : "—"}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
