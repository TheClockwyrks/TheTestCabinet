import {
  useEffect,
  useId,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { SegmentedControl, type SegmentedOption } from "@test-cabinet/ui";
import type {
  GgAgentStatus,
  GgCapabilitySet,
} from "@test-cabinet/run-record/gg";
import dash from "./GgDashboard.module.scss";
import styles from "./GgAgentsSummary.module.scss";
import {
  useGgAgentSummaries,
  type GgAgentSummary,
  type GgAgentSurfaceEntry,
  type GgAgentSurfaceSummary,
} from "./ggAgentAggregate";
import type {
  GgAttributionRow,
  GgViewAttributionRow,
} from "./ggContextAttribution";
import { docViewTypesPhrase, surfaceCallPhrase } from "./ggSurfaceCalls";
import type {
  AgentTransition,
  AgentTreeNode,
  DerivedGgState,
  ModuleSnapshot,
} from "./useGgRunState";
import { callRatePhrase, shortTokens } from "./useGgRunState";
import type { GgAgentModuleSharing, GgAgentModuleSummary } from "./ggModules";
import {
  moduleKindLabel,
  moduleReportsContents,
  useGgModules,
} from "./ggModules";
import {
  GgModuleHeader,
  ModuleContents,
  moduleContentSummary,
} from "./GgModuleViews";
import { MODULE_ICONS } from "./ggAgentEntries";
import {
  CostWidget,
  TokensWidget,
  errorRatePhrase,
  formatCost,
  formatPercent,
} from "./GgOverviewWidgets";
import { useGgExplorerNav, type GgExplorerNav } from "./GgExplorerNav";

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
    (agent.calls.surface === "api"
      ? "API function calls per assistant response — "
      : "Tool and function calls per assistant response — ") +
    `${callRatePhrase(agent.calls.totalCalls, agent.turns)}, ` +
    "summed over every instance of this agent. " +
    "A proxy for efficiency: an agent that does more per round trip spends fewer responses, " +
    "less latency, and less context reaching the same place."
  );
}

/** How many rows a context breakdown shows before the rest fold behind a "show all". */
const ATTRIBUTION_ROWS_SHOWN = 8;

/**
 * How the three readings of an agent's window are labelled.
 *
 * "Views" rather than "Files" because the grain covers both kinds of view an agent can open:
 * a workspace file it asked to see, and a value it composed and showed itself. Both are
 * material the agent *chose* to keep resident, which is the thing this reading ranks.
 */
type AttributionView = "views" | "tools" | "sources";

const ATTRIBUTION_VIEWS: ReadonlyArray<SegmentedOption<AttributionView>> = [
  { value: "views", label: "Views" },
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
  /** The successions — what each of them did to each module (a store's lifetime). */
  transitions: AgentTransition[];
  /** The latest contents of every module instance, keyed by module id. */
  moduleSnapshots: Map<string, ModuleSnapshot>;
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
  transitions,
  moduleSnapshots,
  focusProfile,
  onFocusHandled,
}: GgAgentsSummaryProps) {
  // The run folded by module instance, so a profile's row can say whether its twelve
  // instances read one store or twelve. Folded here, beside the per-profile fold, for the
  // same reason that one is: both cost nothing while this tab is closed.
  const modules = useGgModules(
    capabilitySet,
    agentForest,
    perAgent,
    transitions,
    moduleSnapshots,
  );
  const summaries = useGgAgentSummaries(
    capabilitySet,
    agentForest,
    perAgent,
    modules,
  );
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
              agent.callsPerResponse != null
                ? agent.callsPerResponse.toFixed(1)
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
//
// The detail leads with the instances the profile actually spawned, and then with what they
// were configured as — the capabilities the arm was granted and the surface gg resolved out
// of them. The instances come first because they are the concrete thing the row was opened
// to reach: every figure under here is a sum over them, each chip is the way into that one
// instance's own explorer, and a reader who wants a specific instance should not have to
// scroll past the arm's configuration to find it. The capability chips and the resolved
// surface then annotate them — what this arm asked for, and what gg gave them of it — which
// is the order the two are read in once you know how many there were. Then six content
// sections in one order: the summed figures, the two spend widgets that take the money and
// token figures of that row apart, what those instances hold, what filled their windows,
// and what they called. Each is a direct child of
// `.agentDetail`, so every boundary between them is the single gap that container sets — see
// the stylesheet for why the uniformity is deliberate.
// The tools this profile's chips mark as struck, and whether that marking is a finding or
// only a reading of the configuration.
//
// gg's own account wins wherever there is one. It holds exactly the `disabledTools` entries
// that NAME A GG TOOL, because a name gg does not recognise withholds nothing — gg warns at
// startup and offers the agent the surface it would have had — so a typo is absent from it
// and a chip claiming an ablation that never applied cannot be drawn. Re-reading the
// configuration here would draw precisely that chip, on the panel whose whole job is telling
// "the harness never gave it" apart from "the model ignored it".
//
// The configuration is the fallback and only the fallback: a profile the run never spawned has
// no account to prefer. There the chips still say what the arm asked for — losing that would
// leave an unexercised arm undescribed — but they say it as a request rather than as an outcome.
function agentAblation(agent: GgAgentSummary): {
  tools: readonly string[];
  applied: boolean;
} {
  if (agent.surface) return { tools: agent.surface.withheld, applied: true };
  return { tools: agent.disabledTools, applied: false };
}

function AgentDetail({ agent }: { agent: GgAgentSummary }) {
  const ran = agent.instances.length > 0;
  const ablation = agentAblation(agent);
  return (
    <>
      {/* Who actually ran, first — see the note above this component. It renders nothing at
          all for a profile the run never spawned, so it needs no guard of its own: the
          `never` line below is that case's whole answer. */}
      <InstanceChips agent={agent} />

      {(agent.capabilities.length > 0 || ablation.tools.length > 0) && (
        <div className={styles.capabilities}>
          {agent.capabilities.map((id) => (
            <span key={id} className={dash.capability}>
              {id}
            </span>
          ))}
          {ablation.tools.map((tool) => (
            <span
              key={`-${tool}`}
              className={styles.disabledTool}
              title={
                ablation.applied
                  ? "withheld from this agent even though its capability is on"
                  : "the configuration asks for this to be withheld; no instance of this agent reported what it was offered, so whether it applied is unknown"
              }
            >
              −{tool}
            </span>
          ))}
        </div>
      )}

      {/* Directly under the capability chips, because it is the same statement made one step
          later: those chips are what the configuration asked for, this is what gg resolved
          out of them for the instances that actually ran — with the struck chips above
          already gg's own (see `agentAblation`). It renders nothing at all for a profile
          the run never spawned, whose instances therefore reported no surface. */}
      <SurfaceSection agent={agent} />

      {ran ? (
        <>
          {/* The summed figures lead the content: "how many ran, how they ended, what a
              typical one cost, how hard they leaned on the window" is the question the row
              was opened to ask, and everything under it is one of those figures taken
              apart. */}
          <AgentStats agent={agent} />
          {/* The same Tokens and Cost widgets the Dashboard and an instance's Overview use,
              fed this agent's summed usage — so a profile's spend reads in the shape a run's
              spend does, rather than as a differently-shaped summary. They sit immediately
              under the figures because that is exactly what they are: the `tokens each` and
              `cost each` stats decomposed into their classes. Two separate sections at the
              detail's full width rather than a pair of columns — each carries a rate, two
              composition rings, or a per-class split, and halving the column squeezed all of
              that into a pair of narrow towers. */}
          <TokensWidget
            usage={agent.usage}
            throughput={agent.tokensPerSecond}
            bare
            wide
          />
          <CostWidget usage={agent.usage} breakdown={agent.cost} bare />
          {/* What those instances *hold*, as against what they spent — the answer to the
              question the instance chips raise, and the one section here that is not a sum:
              twelve instances may be reading one store or twelve. */}
          <ModulesSection agent={agent} />
          <ContextBreakdown agent={agent} />
          <CallsSection agent={agent} />
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

// --- What the agent was offered ------------------------------------------------
//
// Everything this profile's instances could call, as gg resolved it for each of them: the
// tools a tool-calling agent was handed, or the API objects a responses-as-code program
// binds.
//
// It exists to make one distinction readable that nothing else on this panel can make. The
// observed-usage section at the foot of the detail lists what an agent *called*, so a tool it
// was never given and a tool it was given and ignored look identical there — and telling
// those two apart is the entire question a toolset ablation is run to answer. So this section
// lists the offered set whole, keeps the never-called entries in it rather than dropping
// them, and only dims them.
//
// The union across instances is the aggregate's, not this file's (see
// {@link GgAgentSurfaceSummary}), and it is deliberately not averaged away: a profile's
// instances legitimately differ, since where an instance stands in its state machine gates
// what it may call. An entry short of the full count therefore says something true about the
// run rather than reporting a disagreement, and is marked with the count instead of hidden.

// Whether a profile's surface reads as API objects rather than as a flat list of tools.
//
// Decided by the mode the instances themselves reported rather than by the capability set:
// the capability says what was asked for, this says what gg resolved, and only the second
// knows which shape the agent's turn actually took. The fallback covers the two answers a
// mode cannot give — instances that disagreed, and a mode this console has not met — where
// what the instances actually bound is the better witness than a name nothing here
// understands. A code agent that bound no object at all falls back with them, and reads as
// the tools its program's calls were gated on, which is the only surface there is to show.
function readsAsApis(surface: GgAgentSurfaceSummary): boolean {
  if (surface.executionMode === "tool_calling") return false;
  return surface.apis.length > 0;
}

// The offered surface of one profile: its tools, or its API objects and what each binds.
function SurfaceSection({ agent }: { agent: GgAgentSummary }) {
  const { surface } = agent;
  const asApis = surface != null && readsAsApis(surface);
  // The profile's observed calls, keyed the way this section's entries are RECORDED: an API
  // surface joins on the OPERATION — gg's own identity for what the call does — and a tool
  // surface on the gg tool name. Two layers over one core, and only the layer this section is showing.
  // Both come off the raw per-layer records rather than off the profile's call breakdown,
  // which reports only the layer that profile's read-out is taken on: the two questions can
  // legitimately part company for a code profile that bound no API objects at all, which is
  // read as APIs nowhere and shows the tools its calls were gated on here.
  const calls = asApis ? agent.apiCalls : agent.toolCalls;
  if (!surface) return null;

  if (!asApis && surface.tools.length === 0) return null;
  const label = asApis ? "APIs" : "Tools";
  // Entries under the names they are explained by. A chip reads by its bare function name
  // under the module heading above it; a hover has to qualify it, since two modules may each
  // declare a `close` and `readFile` alone would not say whose.
  //
  // The key is left exactly as the surface reports it — gg's operation id, which is already
  // whole — while the NAME is qualified by the module's spelling, because those are the two
  // vocabularies: one to count in, one to read in.
  const shown: GgAgentSurfaceEntry[] = asApis
    ? surface.apis.flatMap((api) =>
        api.functions.map((fn) => ({
          ...fn,
          name: `${api.path}.${fn.name}`,
        })),
      )
    : surface.tools;
  // The markings are only worth explaining where the section actually carries one — a legend
  // for a distinction nothing below it draws is a line to read and discard.
  const counts = shown.map((entry) => entryCount(entry, calls));
  const notes = [
    counts.some((count) => count === 0)
      ? "Dimmed entries read a real 0×: offered, and not used."
      : null,
    shown.some((entry) => entry.offeredBy < surface.reportingInstances)
      ? `A fraction marks an entry only some of the ${plural(surface.reportingInstances, "instance")} were offered — where an instance stands in its state machine gates what it may call.`
      : null,
  ].filter((note): note is string => note != null);

  return (
    <section
      className={styles.section}
      aria-label={`${agent.name} ${label.toLowerCase()}`}
    >
      <span className={dash.cardLabel}>
        {asApis
          ? `APIs · ${plural(surface.apis.length, "module")}`
          : `Tools · ${numberFmt.format(surface.tools.length)} offered`}
        {/* The documentation mode, beside the label rather than buried below it: it is the ARM
            of a comparison a single run holds both sides of, and the documentation figures
            further down this detail are its effect. Showing the cost without the cause is
            what makes a within-run A/B unreadable at exactly the grain it is read at. Only
            for an API surface — a tool-calling profile has no documentation lookups — and only
            where the profile's instances agree, since the aggregate reports no mode rather
            than an arbitrary one when they do not. */}
        {asApis && surface.docViewTypes && (
          <span
            className={styles.surfaceMode}
            title={docViewTypesPhrase(surface.docViewTypes, "profile")}
          >
            docs: {surface.docViewTypes}
          </span>
        )}
      </span>
      {asApis ? (
        <ul className={styles.surfaceApis}>
          {surface.apis.map((api) => (
            <li key={api.module || api.path} className={styles.surfaceApi}>
              <div className={styles.surfaceApiHead}>
                <span className={styles.surfaceObject}>{api.path}</span>
                <span className={styles.surfaceObjectDesc}>
                  {api.description}
                </span>
              </div>
              <SurfaceEntries
                entries={api.functions}
                module={api.path}
                calls={calls}
                instances={surface.reportingInstances}
              />
            </li>
          ))}
        </ul>
      ) : (
        <SurfaceEntries
          entries={surface.tools}
          calls={calls}
          instances={surface.reportingInstances}
        />
      )}
      {notes.length > 0 && (
        <p className={styles.sectionNote}>{notes.join(" ")}</p>
      )}
    </section>
  );
}

// How often one offered entry was called: its own figure, on its own identity.
//
// Every entry carries an identity — a tool's own name, or gg's operation id — so every entry
// has a figure, and a zero is a measurement rather than an absence.
function entryCount(
  entry: GgAgentSurfaceEntry,
  calls: ReadonlyMap<string, number>,
): number {
  // The key is whole on both surfaces, so nothing is prefixed here: an operation carries its
  // own namespace.
  return calls.get(entry.key) ?? 0;
}

// The offered things themselves, as chips: a set rather than a ranking, so it is read for
// what is and is not in it rather than down a column of counts.
//
// A chip reads by its bare name under the module heading above it, and explains itself by the
// qualified one: `readFile` is not enough to say which module's function a hover is about, and
// two modules may each declare a `close`.
function SurfaceEntries({
  entries,
  module,
  calls,
  instances,
}: {
  entries: readonly GgAgentSurfaceEntry[];
  /**
   * The module these functions live in, where they live in one — the prefix a hover reads
   * them by. It qualifies the NAME only: the count is joined on the entry's own key, which
   * needs no qualifying.
   */
  module?: string;
  /** The profile's observed calls, keyed the way this section's entries are recorded. */
  calls: ReadonlyMap<string, number>;
  /** The instances the union was taken over — the denominator of "offered by N of them". */
  instances: number;
}) {
  return (
    <ul className={styles.surfaceEntries}>
      {entries.map((entry) => {
        const qualified =
          module == null ? entry.name : `${module}.${entry.name}`;
        const count = entryCount(entry, calls);
        const partial = entry.offeredBy < instances;
        return (
          <li key={entry.name}>
            <span
              className={styles.surfaceEntry}
              // An attribute rather than a second class, matching how the module views mark
              // a row that is present but no longer live: the chip states a fact about the
              // entry and the stylesheet decides what that looks like.
              data-uncalled={count === 0 ? "" : undefined}
              title={entryTitle(qualified, entry, count, instances)}
            >
              <span>{entry.name}</span>
              {/* Grouped, like every other count on this panel and like the same figure
                  on an instance's own surface file: a profile summing twelve instances'
                  calls is exactly where a four-digit figure turns up. */}
              <span className={styles.surfaceEntryCalls}>
                {numberFmt.format(count)}×
              </span>
              {partial && (
                <span className={styles.surfaceEntryPartial}>
                  {entry.offeredBy}/{instances}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// What a chip says on hover: what became of it, and — where it was not offered to all of
// them — why a profile's instances can honestly differ. The dimming and the fraction are both
// silent about their reason, and this is where the reasons live.
function entryTitle(
  qualified: string,
  entry: GgAgentSurfaceEntry,
  count: number,
  instances: number,
): string {
  const outcome = surfaceCallPhrase(qualified, count);
  if (entry.offeredBy >= instances) return outcome;
  return `${outcome} Offered to ${entry.offeredBy} of the ${plural(instances, "instance")} that reported a surface — an instance's position in its state machine gates what it may call, so an entry only some of them were offered is a fact about where they stood rather than an inconsistency.`;
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

// --- Modules ------------------------------------------------------------------
//
// What this profile's instances *hold*, as against what they did.
//
// It is the one thing on this panel that is not a sum, and it is here for exactly that
// reason: every other figure folds twelve instances into one number because the instances
// are twelve samples of one arm, and module state does not fold — twelve instances may be
// reading one store or twelve, and *which of those it is* is the configuration under test.
// A profile whose `shared` memories quietly resolved to twelve private notebooks reads
// identically to one whose sharing worked in every other view in the console.
//
// So each row states the distribution first and never averages it away. The one case whose
// contents can honestly be shown at this grain — one store, bound by every instance at once
// — shows them inline, framed as the agent's; every other case says how many stores there
// are and leaves comparing them to the Modules tab, which is where stores are read side by
// side. Every row is itself the way there (see {@link ModuleRow}).

// The five distributions, in the two words a badge has room for.
const SHARING_LABELS: Record<GgAgentModuleSharing, string> = {
  agent: "agent-scoped",
  instance: "per instance",
  carried: "handed on",
  run: "run-global",
  mixed: "split",
};

// What each of them means, for a reader who has not met the distinction before — and, for
// `carried`, the one that a holder count alone gets wrong.
const SHARING_HINTS: Record<GgAgentModuleSharing, string> = {
  agent:
    "One store, bound by every instance of this agent at once — what one writes, the others read. This is the only shape whose contents belong to the agent rather than to an instance.",
  instance:
    "Every instance holds a store of its own. Nothing here belongs to the agent, so nothing is shown: any single rendering would be a lie about the other instances.",
  carried:
    "One store, but held one instance at a time — a succession handed it on. It reads as several holders and is not sharing: only ever one of them had it.",
  run: "The store these instances bind reaches beyond this agent — the run's board, or a store a spawner of another profile owns.",
  mixed:
    "Several stores, at least one of them genuinely shared: some instances bound it and some did not. Usually worth opening.",
};

// The whole module read-out for one profile.
function ModulesSection({ agent }: { agent: GgAgentSummary }) {
  const nav = useGgExplorerNav();
  if (agent.modules.length === 0) return null;
  return (
    <section className={styles.section} aria-label={`${agent.name} modules`}>
      <span className={dash.cardLabel}>Modules · {agent.modules.length}</span>
      {/* No preamble explaining the distinction: every row states its own distribution as a
          badge with the explanation on it and then spells the same thing out as a sentence
          directly beneath, so a paragraph above the list only said a third time what each
          row is already about to say for itself. */}
      <ul className={styles.modules}>
        {agent.modules.map((row) => (
          <ModuleRow key={row.kind} agent={agent} row={row} nav={nav} />
        ))}
      </ul>
    </section>
  );
}

// What a click inside a module row can land on that is somebody else's to answer for: the
// row's own overlay, a store's id and its holder chips, and every control an agent-scoped
// store's read-out renders. Matched by *shape* rather than by class name, so a control added
// to `GgModuleViews` later is exempt without this file having to be told about it — a row is
// a container for other people's markup, and enumerating it here would go stale silently.
const INTERACTIVE_DESCENDANT =
  'button, a, summary, input, select, textarea, [role="button"]';

// Whether the click that just landed is really the release of a drag across some text. The
// module rows carry the longest prose on the panel — the sharing sentence and the divergence
// notes — and a row that navigated away the moment a selection was let go would be a row
// nobody could quote.
function endsATextSelection(): boolean {
  const selection = window.getSelection();
  return selection != null && selection.toString().length > 0;
}

// One module kind, at the profile's grain: how its stores are distributed, where that
// diverges from what the configuration asked for, and then either the store itself or a list
// of the several there turned out to be.
//
// The whole row is the way through to the Modules tab's read-out of this kind — a profile's
// row can say "twelve stores, four of them never written to" but it can never compare them,
// and comparing them is the next question every one of these rows raises. That used to be a
// "Compare in Modules" button on the one branch that had room for it; it is now the row
// itself, so the affordance is the same on every distribution rather than on one of five.
//
// It cannot be a `<button>` wrapping the row: two of the three branches below render buttons
// of their own (a store's holder chips, its id, the agent-scoped store's header links) and
// nested buttons are invalid HTML — the browser is free to drop the inner ones, which is
// exactly the way out to an instance that must keep working. So the row stays a `<section>`
// and the target is split by input device, which is the only shape that covers the *whole*
// row without nesting anything inside anything:
//
//   - the **mouse** target is the `<section>`'s own `onClick`, so a click lands wherever the
//     row is — including over an agent-scoped store's header and contents, the branch with
//     by far the most vertical extent and the one readers most want to compare;
//   - the **keyboard** target is a button overlaid on the row's inset, carrying the
//     accessible name and the focus ring. It is `pointer-events: none`, so it is reached
//     only by the tab order and fired only by activation (Enter/Space, or assistive tech) —
//     which is what keeps it from covering anything: the prose under it stays selectable and
//     no control under it has to be raised out of its way.
//
// The row's handler owes two exemptions for that to be honest. A click that landed on a
// genuinely interactive descendant is that descendant's — including the overlay's own
// activation click, which bubbles here and is bailed on by the same rule rather than
// navigating twice. And a click that merely releases a drag is the end of a *selection*, not
// a click on the row: the divergence notes are the longest prose in the section, and throwing
// the reader onto another tab the instant they finish selecting one would make it uncopyable.
//
// Without a nav channel (a panel rendered outside the explorers) there is nowhere to go, so
// there is no overlay, no handler and no `data-clickable`: the row is inert, as it was before.
function ModuleRow({
  agent,
  row,
  nav,
}: {
  agent: GgAgentSummary;
  row: GgAgentModuleSummary;
  nav: GgExplorerNav | null;
}) {
  const Icon = MODULE_ICONS[row.kind];
  const stores = row.instances.length;
  const openModuleKind = nav?.openModuleKind;
  // Attached only where the overlay is rendered, so the row's two halves are never out of
  // step with each other or with the affordances `data-clickable` turns on.
  const onRowClick = openModuleKind
    ? (event: ReactMouseEvent<HTMLElement>) => {
        const target = event.target as Element | null;
        if (target?.closest(INTERACTIVE_DESCENDANT) != null) return;
        if (endsATextSelection()) return;
        openModuleKind(row.kind);
      }
    : undefined;
  return (
    <li>
      {/* Named, because a row can carry a whole store's contents and the reader has to be
          able to tell — by ear as well as by eye — which kind's state they are looking at
          and whose it is. */}
      <section
        className={styles.moduleRow}
        data-sharing={row.sharing}
        // Present only when the row really is clickable, since it is what turns on the
        // hover, focus and cursor affordances that promise it can be.
        data-clickable={openModuleKind ? "" : undefined}
        aria-label={`${agent.name} ${row.kind}`}
        onClick={onRowClick}
      >
        {/* The keyboard's half of the target. First child so it leads the row in the tab
            order, which is where a target for the whole row belongs; and labelled with where
            it goes rather than with what it covers, since it has no text of its own and
            "memories" alone would read as a second name for the row. */}
        {openModuleKind && (
          <button
            type="button"
            className={styles.moduleRowOverlay}
            aria-label={`Compare ${moduleKindLabel(row.kind).toLowerCase()} across instances in Modules`}
            onClick={() => openModuleKind(row.kind)}
          />
        )}
        <div className={styles.moduleRowHead}>
          <Icon className={styles.moduleRowIcon} />
          <span className={styles.moduleRowKind}>
            {moduleKindLabel(row.kind)}
          </span>
          <span
            className={styles.sharingBadge}
            data-sharing={row.sharing}
            title={SHARING_HINTS[row.sharing]}
          >
            {SHARING_LABELS[row.sharing]}
          </span>
          <span className={styles.moduleRowFacts}>
            {plural(stores, "store")} · {row.holdingInstances} of{" "}
            {plural(agent.instances.length, "instance")}
            {row.cost ? ` · ${shortTokens(row.cost.latestTokens)}/turn` : ""}
          </span>
        </div>
        <p className={styles.moduleRowLine}>{sharingSentence(row)}</p>
        {/* Where the configuration and the run disagree — always legal, never silent. */}
        {row.divergences.map((divergence, index) => (
          <p key={index} className={styles.divergence}>
            <strong className={styles.divergenceHead}>
              Declared {divergence.declared}, observed {divergence.observed}.
            </strong>{" "}
            {divergence.note}
          </p>
        ))}
        {row.agentScoped ? (
          <AgentScopedStore agent={agent} row={row} nav={nav} />
        ) : row.sharing === "instance" ? (
          <PerInstanceStores row={row} />
        ) : (
          <StoreList row={row} nav={nav} />
        )}
      </section>
    </li>
  );
}

// How this profile's instances stand to this kind's stores, in one sentence — the sentence
// the badge is the two-word version of.
function sharingSentence(row: GgAgentModuleSummary): string {
  const label = moduleKindLabel(row.kind).toLowerCase();
  const first = row.instances[0]?.module;
  const stores = row.instances.length;
  switch (row.sharing) {
    case "agent":
      return `One store — ${first?.id} — bound by ${plural(row.holdingInstances, "instance")} of this agent at once: what one writes, the next reads.`;
    case "carried": {
      const holders = first?.holders ?? [];
      const from = holders[0]?.agentId ?? "its first holder";
      const to = holders[holders.length - 1]?.agentId ?? "its successor";
      return `One store, held one instance at a time: ${first?.id} passed from ${from} to ${to}, so only ever one instance had it.`;
    }
    case "run":
      return `${first?.id} reaches beyond this agent — ${plural(first?.holders.length ?? 0, "holder")} across the run — so it is the run's state rather than this agent's.`;
    case "instance":
      return row.holdingInstances === 1
        ? `The one instance holding ${label} has a store of its own.`
        : `${plural(stores, "store")} for ${plural(row.holdingInstances, "instance")}: every instance's ${label} is its own, so there is nothing here that belongs to the agent.`;
    case "mixed":
      return `${plural(stores, "store")} across ${plural(row.holdingInstances, "instance")} — some bound a shared one and some did not.`;
  }
}

// The one store every instance of the profile binds, shown in full and framed as the
// agent's.
//
// This is the user's explicit ask, and it is legitimate here precisely because there is
// nothing to aggregate: with one store the profile's memories *are* that store. The frame is
// not decoration — the whole risk of putting instance-shaped state on a profile's row is a
// reader taking one instance's notes for the agent's, so the region says which it is, in
// words, above the contents.
function AgentScopedStore({
  agent,
  row,
  nav,
}: {
  agent: GgAgentSummary;
  row: GgAgentModuleSummary;
  nav: GgExplorerNav | null;
}) {
  const module = row.agentScoped;
  if (!module) return null;
  return (
    <section
      className={styles.agentScoped}
      aria-label={`${agent.name} agent-scoped ${row.kind}`}
    >
      <span className={styles.agentScopedLabel}>
        Agent-scoped — one store, read here once for the whole agent rather than
        once per instance
      </span>
      {/* The same strip the store carries on the other two surfaces, read from no holder
          in particular: its id, whether the holders' prompts carry it, its lifetime, what
          it costs their windows between them, and every instance in it as a chip. */}
      <GgModuleHeader
        module={module}
        holder={null}
        onOpenHolder={
          nav
            ? (agentId) =>
                nav.openAgent(agentId, { kind: "module", module: row.kind })
            : undefined
        }
        onOpenModule={
          nav?.openModule ? () => nav.openModule!(module.id) : undefined
        }
      />
      <ModuleContents module={module} holder={null} state={null} />
    </section>
  );
}

// The instance-scoped case: how many stores there are, how many were never written to, and
// what one costs on average. Deliberately no contents — there are N of them and any one of
// them shown here would read as the agent's — and deliberately no link of its own either:
// comparing the N is what the whole row now opens, so a button repeating that inside the row
// would be a second control for the target the row already is.
function PerInstanceStores({ row }: { row: GgAgentModuleSummary }) {
  // "Never written to" is only a statement a kind that HAS contents can bear. A window
  // reports itself per turn as a context breakdown rather than as a snapshot, so counting
  // its absent snapshot would report every conversation window in the run as unused.
  const reportsContents = moduleReportsContents(row.kind);
  const untouched = reportsContents
    ? row.instances.filter((hold) => moduleContentSummary(hold.module) == null)
        .length
    : 0;
  const each =
    row.cost && row.holdingInstances > 0
      ? row.cost.latestTokens / row.holdingInstances
      : null;
  return (
    <span className={styles.moduleRowMeta}>
      {!reportsContents
        ? plural(row.instances.length, "store")
        : untouched > 0
          ? `${untouched} of ${plural(row.instances.length, "store")} never written to`
          : `all ${plural(row.instances.length, "store")} in use`}
      {each != null && ` · ~${shortTokens(Math.round(each))}/turn each`}
    </span>
  );
}

// The stores themselves, for the shapes where there are few of them and which one is which
// matters: a handed-on store, a run-global one, and the split case worth opening. Each row
// names its holders, so the way back to an instance is one click from the profile's grain.
function StoreList({
  row,
  nav,
}: {
  row: GgAgentModuleSummary;
  nav: GgExplorerNav | null;
}) {
  const reportsContents = moduleReportsContents(row.kind);
  const openModule = nav?.openModule;
  return (
    <ul className={styles.stores}>
      {row.instances.map(({ module, holdersInProfile }) => {
        const title = `${holdersInProfile} of this agent's instances hold it, ${plural(module.holders.length, "holder")} in all`;
        return (
          <li key={module.id} className={styles.storeRow}>
            {openModule ? (
              <button
                type="button"
                className={styles.storeId}
                title={title}
                onClick={() => openModule(module.id)}
              >
                {module.id}
              </button>
            ) : (
              <span className={styles.storeId} title={title}>
                {module.id}
              </span>
            )}
            <span className={styles.storeHolders}>
              {module.holders.map((holder) =>
                nav ? (
                  <button
                    key={holder.agentId}
                    type="button"
                    className={styles.storeHolder}
                    onClick={() =>
                      nav.openAgent(holder.agentId, {
                        kind: "module",
                        module: row.kind,
                      })
                    }
                  >
                    {holder.agentId}
                  </button>
                ) : (
                  <span key={holder.agentId} className={styles.storeHolder}>
                    {holder.agentId}
                  </span>
                ),
              )}
            </span>
            <span className={styles.storeContents}>
              {moduleContentSummary(module) ??
                (reportsContents ? "nothing in it" : "—")}
            </span>
            <span className={styles.storeCost}>
              {module.totalCost
                ? `${shortTokens(module.totalCost.latestTokens)}/turn`
                : "—"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// "1 store" / "3 stores" — spelled once, since these rows count five different things.
function plural(count: number, noun: string): string {
  return `${numberFmt.format(count)} ${noun}${count === 1 ? "" : "s"}`;
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
      {/* How many of those turns the profile could not carry out — the same judgement
          gg's error ceilings are enforced on, kept rather than discarded when each
          instance's loop ended. Beside `turns` because it is read against it, and with
          the streak in the sub, because a profile that fails a tenth of its turns
          scattered and one that fails ten in a row and stops are the same percentage. */}
      <Stat
        label="errored turns"
        value={
          agent.errors.turns === 0 ? "—" : numberFmt.format(agent.errors.errors)
        }
        sub={errorRatePhrase(agent.errors)}
        title="Turns whose declared work could not be carried out — a failed model call, a program that did not compile, threw, or hit a sandbox ceiling, or a turn that declared no work at all. A tool call that failed inside a program that carried on is not one."
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
          own rates — see `GgAgentSummary.callsPerResponse` for why. The sub says both
          halves so the ratio can be checked against the numbers it came from. */}
      <Stat
        label="calls per response"
        value={
          agent.callsPerResponse != null
            ? agent.callsPerResponse.toFixed(1)
            : "—"
        }
        sub={`${numberFmt.format(agent.calls.totalCalls)} calls · ${numberFmt.format(agent.turns)} responses`}
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

// What each reading says when it has nothing to show. Spelled out per reading rather than
// interpolating the selector's own word, since "came from views" is not what an empty view
// list means — a view is material the agent asked for, not a place material came from.
const ATTRIBUTION_EMPTY: Record<AttributionView, string> = {
  views:
    "This agent opened no views — it neither asked to see a file nor showed itself a value.",
  tools: "Nothing in this agent's window came from a tool.",
  sources: "Nothing in this agent's window was attributed to a context band.",
};

// What filled this agent's windows, and what carrying it cost. The three readings of one
// accounting — by view, by tool, by band — behind a selector, since they answer the same
// question at different grains and stacking all three would bury the one being read.
function ContextBreakdown({ agent }: { agent: GgAgentSummary }) {
  const [view, setView] = useState<AttributionView>("views");
  const { context } = agent;
  const rows: readonly (GgAttributionRow | GgViewAttributionRow)[] =
    view === "views"
      ? context.byView
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
        <p className={styles.empty}>{ATTRIBUTION_EMPTY[view]}</p>
      ) : (
        <AttributionList rows={rows} total={context.billedTokens} />
      )}
      {view === "views" && context.unattributedViewTokens > 0 && (
        <p className={styles.sectionNote}>
          {shortTokens(Math.round(context.unattributedViewTokens))} of views
          could not be traced to a selector — a file view carried across a
          compaction on a stream recorded before gg tagged it.
        </p>
      )}
    </section>
  );
}

// The bars themselves: each thing the window carried, its share of the agent's billed input,
// and what that share cost. Long lists fold after the leaders, since the tail of a file list
// is a hundred one-turn reads nobody is tuning against.
//
// A view row additionally says which kind of view it is, because its label alone does not: an
// agent that labels a text view `notes.md` is indistinguishable from one that read a file of
// that name, and the two cost the operator entirely different decisions.
function AttributionList({
  rows,
  total,
}: {
  rows: readonly (GgAttributionRow | GgViewAttributionRow)[];
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
                {"kind" in row && row.kind === "text" ? "agent view · " : ""}
                {"kind" in row && row.kind === "docs" ? "docs view · " : ""}
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

// Everything this agent's instances called, summed — the itemized version of the Dashboard
// row's chips, but per profile rather than per instance, so "the reviewer reads forty files
// per review" is a thing you can see.
//
// It reads on the surface those instances actually called on, and names it in the heading:
// a profile whose instances answer as code called `fs.readFile`, and heading its observed
// usage "Tool calls" would have put this section and the offered surface directly above it
// — which already reads that profile as APIs — in disagreement about what the profile did,
// on one panel, three lines apart.
//
// Headed "…calls" rather than "Tools"/"APIs": the detail also carries what the agent was
// *offered* (see {@link SurfaceSection}), and the whole point of showing both is that they
// are different sets — one heading for the two of them would have made the section this one
// exists to be contrasted with look like a longer copy of it.
function CallsSection({ agent }: { agent: GgAgentSummary }) {
  const { surface, calls, totalCalls, outputTokensKnown, totalContextTokens } =
    agent.calls;
  if (calls.length === 0) return null;
  return (
    <section className={styles.section}>
      <span className={dash.cardLabel}>
        {surface === "api" ? "API calls" : "Tool calls"} ·{" "}
        {numberFmt.format(totalCalls)}
      </span>
      <ul className={styles.attrList}>
        {calls.map((entry) => {
          const share =
            outputTokensKnown && totalContextTokens > 0
              ? entry.outputTokens / totalContextTokens
              : null;
          return (
            <li key={entry.name} className={styles.attrRow}>
              <span className={styles.attrIdentity}>
                <span className={styles.attrName}>{entry.name}</span>
                <span className={styles.attrMeta}>
                  {(entry.calls / agent.instances.length).toFixed(1)} per
                  instance
                </span>
              </span>
              <span className={styles.attrBar} aria-hidden="true">
                <span
                  className={styles.attrBarFill}
                  style={{
                    width: `${totalCalls > 0 ? (entry.calls / totalCalls) * 100 : 0}%`,
                  }}
                />
              </span>
              <span className={styles.attrFigures}>
                <span className={styles.attrValue}>{entry.calls}×</span>
                {/* The token column is a fact about tool results, which a code turn
                    produces none of — an API row's dash is that absence, not a zero. */}
                <span className={styles.attrShare}>
                  {share != null ? shortTokens(entry.outputTokens) : "—"}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
