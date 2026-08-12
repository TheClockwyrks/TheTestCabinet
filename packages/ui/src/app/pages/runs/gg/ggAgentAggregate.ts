// A gg run read **per configured agent** rather than per running instance.
//
// A gg configuration declares agent *profiles* — Root, a reviewer, an implementer — and the
// run then makes as many instances of each as the work calls for: one Root, four reviewers,
// an implementer per issue. Every other view of a run is per instance (the explorer's tree,
// the Dashboard's agent overview), which is the right shape for "what did agent-7 do" and
// the wrong one for the question this module exists to answer: *is this profile earning what
// it costs?* Twelve implementer instances at forty cents each is a fact about the
// implementer profile, not about any one of them, and reading it off twelve rows is not
// reading it at all.
//
// So this folds the run the other way: group the instances by the profile they ran under and
// sum everything that sums — instances, turns, tokens, cost, the calls they made, and the
// [context accounting](./ggContextAttribution) that says which files and tools filled their
// windows. A profile the configuration declares but the run never instantiated is included
// with nothing in it, because "the reviewer never ran" is one of the more useful things an
// ablation can tell you and an absent row says it silently.
//
// Instances are grouped by the profile name their `agent_spawned` named (the wire's `slot`,
// which is the agent profile — see the telemetry contract). The main agent on a stream
// recorded before gg named it falls back to the configuration's first profile, which is the
// root by definition.

import { useMemo } from "react";
import type {
  GgAgentConfig,
  GgAgentStatus,
  GgCapabilitySet,
} from "@test-cabinet/run-record/gg";
import { useFindModelOptional } from "../../../data/useModels";
import type { ModelNameLookup, ModelPriceLookup, PricedSlot } from "./ggCost";
import {
  agentPricedSlots,
  deriveGgCostBreakdown,
  type GgCostBreakdown,
} from "./ggCost";
import {
  attributeGgContext,
  mergeGgAttributions,
  type GgContextAttribution,
} from "./ggContextAttribution";
import { agentModelMs, generatedTokens } from "./ggThroughput";
// Types only: `ggModules` reads this module's `agentProfileName`, so importing anything
// from it at runtime would close a cycle. A type import erases, and the index itself is
// handed in by the caller that folded it.
import type { GgAgentModuleSummary, GgModuleIndex } from "./ggModules";
import { ROOT_AGENT } from "./ggCatalog";
import { apiCallSpellings } from "./ggSurfaceCalls";
import {
  ROOT_ID,
  addErrorTally,
  emptyErrorTally,
  ggPeakContext,
  callRecordSurface,
  callsPerResponse,
  ggCallBreakdown,
  type AgentTreeNode,
  type DerivedGgState,
  type GgAgentSurface,
  type GgErrorTally,
  type GgCallBreakdown,
  type GgCallUsage,
  type UsageTally,
} from "./useGgRunState";

/** The name instances whose profile the stream never named are grouped under. */
export const UNNAMED_AGENT = "unnamed";

/** One running instance of an agent, as its profile's summary lists it. */
export interface GgAgentInstance {
  /** The instance's agent id — what the Instances explorer knows it by. */
  id: string;
  status: GgAgentStatus;
  /** The concrete model this instance resolved to; null until its spawn is seen. */
  modelId: string | null;
  /** Its depth in the delegation forest (0 for the main agent and dispatched issue agents). */
  depth: number | null;
  turns: number;
  tokens: number;
  /** The fullest its context window ever got, as a fraction and in raw tokens. */
  peakFullness: number | null;
  peakTokens: number;
}

/**
 * One thing a profile's instances were offered: a gg tool, or a function bound on one of a
 * responses-as-code program's API objects.
 *
 * The load-bearing field is {@link key} — the identity the entry's calls are RECORDED under,
 * which is not always the name it reads by. A tool entry is called by its own name; a code
 * program's `readFile` is written as `readFile` and recorded as `read_file`, because a count
 * has to survive a run whose programs were written in another language with other spellings.
 * Every entry has one, tool or no tool: the API layer counts a `view.openFile` and a
 * `context.list` exactly as it counts a read.
 */
export interface GgAgentSurfaceEntry {
  /** The name the entry reads by: the gg tool's name, or the function's name on its object. */
  name: string;
  /**
   * This entry's language-independent identity — the join key into the profile's call counts:
   * {@link GgAgentSummary.toolCalls} for a tool entry, {@link GgAgentSummary.apiCalls} for an
   * API one. Equal to {@link name} for a tool; gg's own operation id (`files.read_file`) for a
   * function, which is what its calls are recorded under whatever language wrote them.
   */
  key: string;
  /**
   * How many of the profile's REPORTING instances were offered it — out of
   * {@link GgAgentSurfaceSummary.reportingInstances}. Short of that total is the interesting
   * case: the instances of one profile genuinely differ, because an FSM state gates the
   * transition call and withholds `exec` while it holds, so an entry only some instances saw
   * is a fact about where in its machine they were, not an inconsistency.
   */
  offeredBy: number;
}

/** One capability module of a profile's offered surface, unioned across its instances. */
export interface GgAgentSurfaceApi {
  /** gg's cross-arm id for the module — `files`, `views`, `session`. */
  module: string;
  /** This arm's own spelling of it, and what the model writes — `gg.files`. */
  path: string;
  /** The one-line description the agents' own system prompts name the module by. */
  description: string;
  /** The functions its instances bound in it, in catalogue order (first-seen wins). */
  functions: GgAgentSurfaceEntry[];
  /** How many of the profile's reporting instances bound the module at all. */
  offeredBy: number;
}

/**
 * What a profile's instances were OFFERED, unioned across them.
 *
 * Like the module roster beside it this does not sum, and for a sharper reason: an offered
 * set is not a quantity, so twelve instances are twelve answers to one question rather than
 * twelve samples of one figure. Where they agree — the normal case — the union is simply
 * that answer; where they differ, taking any one instance's set would silently assert a tool
 * was withheld from a profile that in fact holds it in another state. So the union is the
 * profile's surface and each entry carries the count that says how much of the profile it
 * really covers.
 */
export interface GgAgentSurfaceSummary {
  /**
   * How this profile's instances answer a turn — `tool_calling` or `responses_as_code` — as
   * they THEMSELVES reported it. Deliberately not inferred from the capability set: the
   * capability says what was asked for and this says what gg resolved, and it is the second
   * that decides whether the profile has tools or an API surface. Null only where instances
   * somehow disagree, which no configuration produces.
   */
  executionMode: string | null;
  /**
   * Which SDK types an `openDocsView` opened beside a function for this profile's instances —
   * `off`, `return` or `return-and-parameters`, as gg resolved it. Null for a tool-calling
   * profile, for a record written before gg reported the mode, and — like
   * {@link executionMode} — where instances somehow disagree.
   *
   * It is here because the mode is an arm of a comparison a single run can hold both sides
   * of: what it cost is read off the documentation band of the very agents this summary is
   * about, and a page that showed the cost without the arm would be showing an effect with no
   * cause on it.
   */
  docViewTypes: string | null;
  /**
   * How many instances this union was taken over — the denominator every `offeredBy` reads
   * against. It counts the instances that REPORTED a surface, not every instance of the
   * profile, so a run that mixes reporting and pre-`agent_surface` instances still reads
   * "offered by all of them" for a tool they all held.
   */
  reportingInstances: number;
  /** Every gg tool any instance was offered, in the order the model was shown them. */
  tools: GgAgentSurfaceEntry[];
  /** The modules a responses-as-code profile's programs bind. Empty for tool calling. */
  apis: GgAgentSurfaceApi[];
  /**
   * The tools an ablation took off this profile — gg's own account of it, and only the
   * `disabledTools` entries that NAME A GG TOOL. A name gg does not recognise withheld
   * nothing (gg warns and offers the agent the surface it would have had), so it is absent
   * here, which is the whole reason this is unioned off the instances rather than re-read
   * from the configuration: a typo shown as an applied ablation is the one claim this panel
   * cannot afford.
   *
   * Unlike everything else here the union is uniform by construction — an ablation is a
   * property of the profile, not of where an instance stands in its machine — so the entries
   * carry no `offeredBy` count to read against {@link reportingInstances}.
   */
  withheld: string[];
}

/** Everything one configured agent did, summed across every instance of it. */
export interface GgAgentSummary {
  /** The profile's name — the key instances are grouped by. */
  name: string;
  /**
   * Whether the run's configuration declares this profile. False for a profile observed only
   * on the stream (a record whose configuration was not captured, or an agent spawned under
   * a name the set no longer carries), whose row is therefore an observation rather than a
   * configured arm.
   */
  declared: boolean;
  /** Whether this is the run's root profile — the configuration's first, which is never spawned. */
  root: boolean;
  /** The model the configuration binds the profile to, when it declares one. */
  configuredModelId: string | null;
  /** The models its instances actually ran on, in first-seen order (normally exactly one). */
  modelIds: string[];
  /** The catalog's display name for the profile's model, or the id where it is unknown. */
  modelName: string | null;
  /** The capability ids the configuration has on for this profile. */
  capabilities: string[];
  /** Tools withheld from this profile even where their capability is on (an ablation). */
  disabledTools: string[];
  /** Every instance of the profile, in forest order. */
  instances: GgAgentInstance[];
  /** How many instances ended in each lifecycle state. */
  statusCounts: Record<GgAgentStatus, number>;
  /** The turns its instances took between them. */
  turns: number;
  /**
   * How those turns went, summed across the profile's instances — the figure that says
   * whether this arm of the ablation is one the model can actually drive. A profile
   * failing a third of its turns and finishing anyway looks identical to a clean one in
   * every other figure on this row.
   *
   * {@link GgErrorTally.maxConsecutive} is the worst any ONE instance reached, not a
   * streak across them: twelve reviewers that each failed twice did not fail
   * twenty-four times in a row.
   */
  errors: GgErrorTally;
  /** Its instances' token and cost tallies, summed. */
  usage: UsageTally;
  /** That usage split per (profile, model) so it can be priced at each model's own rate. */
  pricedSlots: PricedSlot[];
  /** The per-class cost split, priced from the catalog. Null when nothing could be priced. */
  cost: GgCostBreakdown | null;
  /** The fullest any of its instances' windows ever got. */
  peakFullness: number | null;
  peakTokens: number;
  /** The mean of its instances' own peaks — how full a *typical* instance got. */
  meanPeakFullness: number | null;
  /** How many times its instances compacted between them. */
  compactions: number;
  /**
   * The profile's generation rate — everything its instances produced over the time they
   * spent inside their model calls, folded across all of them. Null when none of their calls
   * were timed. Summed rather than averaged across instances, so twelve short-lived reviewers
   * read as the one rate their shared model actually generated at rather than as the mean of
   * twelve small samples.
   */
  tokensPerSecond: number | null;
  /**
   * Everything its instances called, most-used first — on the surface those instances
   * answered their turns on. A tool-calling profile's tools, a responses-as-code profile's
   * API functions in the spelling its programs wrote them, decided per instance by
   * `callRecordSurface` and merged (see {@link mergeCallBreakdowns}).
   */
  calls: GgCallBreakdown;
  /**
   * How many times each API function its instances called was called, keyed
   * `object.function` on the function's own identity — `view.open_file`, `context.list`.
   *
   * The raw model-facing record, kept whichever surface {@link calls} reports on, because
   * the offered-surface section joins its entries on the wire identity rather than on the
   * spelling a read-out shows.
   */
  apiCalls: ReadonlyMap<string, number>;
  /**
   * How many times each gg TOOL its instances dispatched was called, keyed by tool name —
   * the execution layer of the pair {@link apiCalls} records above it.
   *
   * Kept beside it for the same reason: the offered-surface section joins a tool-calling
   * profile's entries on this record, whichever surface {@link calls} is reported on.
   */
  toolCalls: ReadonlyMap<string, number>;
  /**
   * How many calls the profile got out of each assistant response — every call its
   * instances made over every turn they took. Null when no instance took a turn.
   *
   * Summed rather than averaged across instances, for the same reason
   * {@link tokensPerSecond} is: a mean of per-instance rates weights a reviewer that took
   * one turn exactly as heavily as an implementer that took a hundred, so twelve
   * short-lived instances would decide a figure their work barely contributed to. The
   * profile's calls over the profile's responses is the question being asked.
   */
  callsPerResponse: number | null;
  /** What filled its instances' windows, and what that material cost. */
  context: GgContextAttribution;
  /**
   * The [modules](./ggModules) its instances hold, one row per kind — and, per kind, whether
   * they hold **one** store between them or one each.
   *
   * This is the only figure on a profile's row that is not a sum. Everything else here folds
   * twelve instances into one number because the instances are twelve samples of one arm;
   * module state does not fold, because twelve instances may be reading one store or twelve,
   * and which of those it is *is the configuration under test*. So the row reports the
   * distribution rather than a total, and names the one store where there is one.
   *
   * Empty for a profile the run never instantiated, and for a run folded without a module
   * index (see {@link deriveGgAgentSummaries}).
   */
  modules: GgAgentModuleSummary[];
  /**
   * What its instances were OFFERED, unioned across them — the counterpart to {@link tools},
   * which is only what they went on to CALL. Reading the two together is the point: a tool
   * present here and absent there was offered and ignored, and a tool absent from both was
   * never on the table at all.
   *
   * Null when no instance reported a surface — a profile the run never instantiated, and
   * every profile of a run recorded before gg emitted `agent_surface`. A consumer must then
   * show nothing rather than an empty toolset, which would read as "offered none".
   */
  surface: GgAgentSurfaceSummary | null;
}

const EMPTY_STATUS_COUNTS: Record<GgAgentStatus, number> = {
  running: 0,
  blocked: 0,
  done: 0,
  failed: 0,
};

// Sum one instance's tally into a profile's running one, on the same null-aware terms the
// stream fold uses: a class counts once a delta reports it, and cost stays unknown until an
// instance carries a figure.
function addTally(into: UsageTally, from: UsageTally): void {
  into.uncachedInput += from.uncachedInput;
  into.cachedInput += from.cachedInput;
  into.output += from.output;
  into.reasoning += from.reasoning;
  into.totalTokens += from.totalTokens;
  into.count += from.count;
  into.anyTokens = into.anyTokens || from.anyTokens;
  if (from.comparable != null)
    into.comparable = (into.comparable ?? 0) + from.comparable;
  if (from.actual != null) into.actual = (into.actual ?? 0) + from.actual;
}

function emptyTally(): UsageTally {
  return {
    uncachedInput: 0,
    cachedInput: 0,
    output: 0,
    reasoning: 0,
    totalTokens: 0,
    anyTokens: false,
    comparable: null,
    actual: null,
    count: 0,
  };
}

/**
 * Sum several instances' call breakdowns into one: call counts and attributed result tokens
 * add up per entry, and the window total they are a share of adds up with them, so a
 * profile's per-entry share still reads against the material its instances actually carried.
 *
 * The merged surface is `"api"` if any part is, because a profile whose instances answered as
 * code has API calls to report and a caption that named tools would be false of them. A
 * profile whose instances disagree about that is pathological — a profile is one arm and its
 * mode is configured per arm — but it is a stream this console can be handed, and the honest
 * reading of it is that the calls the model WROTE are somewhere in the list.
 */
export function mergeCallBreakdowns(
  parts: readonly GgCallBreakdown[],
): GgCallBreakdown {
  const entries = new Map<string, GgCallUsage>();
  let totalContextTokens = 0;
  let outputTokensKnown = false;
  let surface: "tool" | "api" = "tool";
  for (const part of parts) {
    totalContextTokens += part.totalContextTokens;
    outputTokensKnown = outputTokensKnown || part.outputTokensKnown;
    if (part.surface === "api") surface = "api";
    for (const entry of part.calls) {
      const at = entries.get(entry.name);
      if (!at) {
        entries.set(entry.name, { ...entry });
        continue;
      }
      at.calls += entry.calls;
      at.outputTokens += entry.outputTokens;
    }
  }
  const merged = [...entries.values()].sort(
    (a, b) =>
      b.calls - a.calls ||
      b.outputTokens - a.outputTokens ||
      a.name.localeCompare(b.name),
  );
  return {
    surface,
    calls: merged,
    totalCalls: merged.reduce((sum, entry) => sum + entry.calls, 0),
    outputTokensKnown,
    totalContextTokens,
  };
}

/**
 * Union several instances' offered surfaces into their profile's — see
 * {@link GgAgentSurfaceSummary}. Null for no surfaces at all, which is what keeps a profile
 * the run never ran (and every profile of a pre-`agent_surface` record) rendering nothing
 * instead of an empty one.
 *
 * Order is the order the model was shown things — the first instance's registry order, with
 * anything a later instance adds appended — never a frequency sort, because the offered set
 * is meant to be read against what the agent's own prompt listed.
 */
export function mergeAgentSurfaces(
  parts: readonly GgAgentSurface[],
): GgAgentSurfaceSummary | null {
  if (parts.length === 0) return null;

  const tools = new Map<string, GgAgentSurfaceEntry>();
  // Each module's own fold, keyed by gg's id for it: its spelling and description (first
  // seen), how many instances bound it, and its functions in the same first-seen order the
  // modules themselves keep.
  const apis = new Map<
    string,
    {
      path: string;
      description: string;
      offeredBy: number;
      functions: Map<string, GgAgentSurfaceEntry>;
    }
  >();
  const modes = new Set<string>();
  // The documentation mode, folded like the execution mode beside it: a set, so instances
  // that disagree produce no answer rather than an arbitrary one.
  const docModes = new Set<string>();
  // A set, not a tally: every instance of a profile is ablated identically, so a name is
  // either in the profile's control arm or it is not.
  const withheld = new Set<string>();

  for (const part of parts) {
    modes.add(part.executionMode);
    if (part.docViewTypes) docModes.add(part.docViewTypes);
    for (const name of part.withheld) withheld.add(name);
    for (const name of part.tools) {
      const at = tools.get(name);
      if (at) at.offeredBy += 1;
      else tools.set(name, { name, key: name, offeredBy: 1 });
    }
    for (const api of part.apis) {
      // Keyed on gg's module id rather than on the arm's spelling: an `exec` successor may
      // legitimately write its programs in another language, and folding by the spelling
      // would report one module as two the moment it did.
      const id = api.module || api.path;
      let group = apis.get(id);
      if (!group) {
        group = {
          path: api.path,
          description: api.description,
          offeredBy: 0,
          functions: new Map(),
        };
        apis.set(id, group);
      }
      group.offeredBy += 1;
      for (const fn of api.functions) {
        const at = group.functions.get(fn.name);
        if (at) at.offeredBy += 1;
        else
          group.functions.set(fn.name, {
            name: fn.name,
            key: fn.operation,
            offeredBy: 1,
          });
      }
    }
  }

  return {
    // One mode is the answer; a profile whose instances somehow disagree has none, since
    // naming either would decide the read-out's whole shape on a coin toss.
    executionMode: modes.size === 1 ? [...modes][0]! : null,
    docViewTypes: docModes.size === 1 ? [...docModes][0]! : null,
    reportingInstances: parts.length,
    tools: [...tools.values()],
    apis: [...apis.entries()].map(([module, group]) => ({
      module,
      path: group.path,
      description: group.description,
      functions: [...group.functions.values()],
      offeredBy: group.offeredBy,
    })),
    withheld: [...withheld],
  };
}

/**
 * The profile an instance ran under: the name its spawn carried, or — for the main agent on
 * a stream recorded before gg named it — the configuration's first profile, which is the
 * root by definition. An instance the stream never named at all (a placeholder built from an
 * out-of-order status event) is grouped under {@link UNNAMED_AGENT} rather than dropped.
 */
export function agentProfileName(
  node: AgentTreeNode,
  set: GgCapabilitySet | null,
): string {
  if (node.slot) return node.slot;
  if (node.id === ROOT_ID) return set?.agents?.[0]?.name ?? ROOT_AGENT;
  return UNNAMED_AGENT;
}

// The forest flattened into (node, profile) pairs in tree order — root first, each subagent
// after its spawner — so a profile's instances list in the order the run introduced them.
function orderedInstances(
  forest: readonly AgentTreeNode[],
  set: GgCapabilitySet | null,
): Array<{ node: AgentTreeNode; profile: string }> {
  const ordered: Array<{ node: AgentTreeNode; profile: string }> = [];
  const walk = (node: AgentTreeNode) => {
    ordered.push({ node, profile: agentProfileName(node, set) });
    node.children.forEach(walk);
  };
  forest.forEach(walk);
  return ordered;
}

/**
 * Fold a run into one summary per configured agent — see the module docs.
 *
 * `priceOf`/`nameOf` resolve the model catalog, which is what makes the cost split and the
 * context accounting priceable; without them the token figures still hold and every cost
 * reads null. Profiles list in configuration order (the root first), with any profile seen
 * only on the stream after them.
 *
 * `modules` is the run's [module index](./ggModules), whose per-profile fold becomes each
 * row's {@link GgAgentSummary.modules}. It is taken rather than derived here because it is a
 * fold over the *whole* run — a store's holders span profiles, so it cannot be computed one
 * profile at a time — and because three surfaces read it, which is precisely the reason it
 * is one traversal. Null leaves every row's module list empty and changes nothing else.
 */
export function deriveGgAgentSummaries(
  capabilitySet: GgCapabilitySet | null,
  agentForest: readonly AgentTreeNode[],
  perAgent: ReadonlyMap<string, DerivedGgState>,
  priceOf: ModelPriceLookup,
  nameOf: ModelNameLookup,
  modules: GgModuleIndex | null,
): GgAgentSummary[] {
  const declared: GgAgentConfig[] = capabilitySet?.agents ?? [];
  const instances = orderedInstances(agentForest, capabilitySet);

  // Every profile worth a row: the declared ones in configuration order, then any the stream
  // introduced that the configuration does not carry.
  const names: string[] = declared.map((agent) => agent.name);
  for (const { profile } of instances) {
    if (!names.includes(profile)) names.push(profile);
  }

  return names.map((name) => {
    const config = declared.find((agent) => agent.name === name) ?? null;
    const mine = instances.filter((entry) => entry.profile === name);

    const usage = emptyTally();
    const pricedSlots: PricedSlot[] = [];
    // Each instance's call breakdown, on that instance's own surface — the mode is a fact
    // about the incarnation, and only the instance can answer which record its calls are on.
    const callParts: GgCallBreakdown[] = [];
    // The profile's API-call counts, summed across its instances — the raw model-facing
    // record, kept whichever surface the breakdown above reports on — as is the execution
    // record beside it, for the surface section that joins on tool names.
    const apiCalls = new Map<string, number>();
    const toolCalls = new Map<string, number>();
    // Collected off the forest nodes rather than the per-agent slices, so an instance whose
    // slice never materialized still contributes what it was offered — the surface is a fact
    // about the instance opening, not about anything it went on to do.
    const surfaceParts: GgAgentSurface[] = [];
    const contextParts: GgContextAttribution[] = [];
    const statusCounts = { ...EMPTY_STATUS_COUNTS };
    const modelIds: string[] = [];
    const rows: GgAgentInstance[] = [];
    // The profile's error record, summed off its instances' own slices — where the
    // consecutive-error streak is a genuine streak, since a slice is one agent's stream.
    const errors = emptyErrorTally();
    let turns = 0;
    let compactions = 0;
    // The two halves of the profile's generation rate, summed across its instances (see
    // `tokensPerSecond`).
    let generated = 0;
    let modelMs = 0;
    let peakTokens = 0;
    let peakFullness: number | null = null;
    let fullnessSum = 0;
    let fullnessCount = 0;

    for (const { node } of mine) {
      statusCounts[node.status] += 1;
      if (node.modelId && !modelIds.includes(node.modelId))
        modelIds.push(node.modelId);
      if (node.surface) surfaceParts.push(node.surface);

      const state = perAgent.get(node.id);
      if (!state) {
        rows.push({
          id: node.id,
          status: node.status,
          modelId: node.modelId,
          depth: node.depth,
          turns: 0,
          tokens: 0,
          peakFullness: null,
          peakTokens: 0,
        });
        continue;
      }

      const peak = ggPeakContext(state);
      addTally(usage, state.usage);
      addErrorTally(errors, state.errors);
      turns += state.turnCount;
      compactions += state.compactions.length;
      generated += generatedTokens(state.usage);
      modelMs += agentModelMs(state);
      pricedSlots.push(
        ...agentPricedSlots(state.slotUsage, state.usage, node.modelId),
      );
      callParts.push(
        ggCallBreakdown(
          state,
          callRecordSurface(state.apiCalls, node.surface?.executionMode),
          node.surface ? apiCallSpellings(node.surface.apis) : undefined,
        ),
      );
      for (const [call, count] of state.apiCalls)
        apiCalls.set(call, (apiCalls.get(call) ?? 0) + count);
      for (const [tool, count] of state.toolCalls)
        toolCalls.set(tool, (toolCalls.get(tool) ?? 0) + count);
      contextParts.push(attributeGgContext(state, node.modelId, priceOf));
      if (peak) {
        if (peak.tokens > peakTokens) peakTokens = peak.tokens;
        if (peak.fullness != null) {
          if (peakFullness == null || peak.fullness > peakFullness)
            peakFullness = peak.fullness;
          fullnessSum += peak.fullness;
          fullnessCount += 1;
        }
      }
      rows.push({
        id: node.id,
        status: node.status,
        modelId: node.modelId,
        depth: node.depth,
        turns: state.turnCount,
        tokens: state.usage.totalTokens,
        peakFullness: peak?.fullness ?? null,
        peakTokens: peak?.tokens ?? 0,
      });
    }

    // The model the row reads by: what the configuration binds, else what the instances
    // actually ran on (a record with no captured configuration still names its model).
    const modelId = config?.modelId || modelIds[0] || null;
    // Merged once and read twice: the profile's per-entry list, and the call rate taken
    // against the turns those same instances took (see `callsPerResponse`).
    const calls = mergeCallBreakdowns(callParts);
    return {
      name,
      declared: config != null,
      root: declared.length > 0 && declared[0]?.name === name,
      configuredModelId: config?.modelId || null,
      modelIds,
      modelName: modelId ? (nameOf(modelId) ?? modelId) : null,
      capabilities:
        config?.capabilities.filter((c) => c.enabled).map((c) => c.id) ?? [],
      disabledTools: config?.disabledTools ?? [],
      instances: rows,
      statusCounts,
      turns,
      errors,
      usage,
      pricedSlots,
      cost: deriveGgCostBreakdown(pricedSlots, priceOf),
      peakFullness,
      peakTokens,
      meanPeakFullness: fullnessCount > 0 ? fullnessSum / fullnessCount : null,
      compactions,
      tokensPerSecond: modelMs > 0 ? generated / (modelMs / 1000) : null,
      calls,
      apiCalls,
      toolCalls,
      callsPerResponse: callsPerResponse(calls, turns),
      context: mergeGgAttributions(contextParts),
      modules: modules?.byProfile.get(name) ?? [],
      surface: mergeAgentSurfaces(surfaceParts),
    };
  });
}

/**
 * The run's per-agent summaries, priced against the loaded model catalog (which also
 * supplies each profile's model display name). The catalog is optional — a console with no
 * gallery provider still gets every token, turn, and instance figure, with costs null.
 *
 * The module index is handed in (see {@link useGgModules}) rather than folded here: it is a
 * whole-run traversal three surfaces share, and it is what keeps this module free of a
 * runtime dependency on the one that reads its `agentProfileName`.
 */
export function useGgAgentSummaries(
  capabilitySet: GgCapabilitySet | null,
  agentForest: readonly AgentTreeNode[],
  perAgent: ReadonlyMap<string, DerivedGgState>,
  modules: GgModuleIndex | null,
): GgAgentSummary[] {
  const findModel = useFindModelOptional();
  return useMemo(
    () =>
      deriveGgAgentSummaries(
        capabilitySet,
        agentForest,
        perAgent,
        (id) => findModel?.(id)?.prices ?? null,
        (id) => findModel?.(id)?.name ?? null,
        modules,
      ),
    [capabilitySet, agentForest, perAgent, findModel, modules],
  );
}
