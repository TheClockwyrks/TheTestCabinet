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
// sum everything that sums — instances, turns, tokens, cost, tool calls, and the
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
import {
  ROOT_ID,
  ggPeakContext,
  ggToolBreakdown,
  toolCallsPerResponse,
  type AgentTreeNode,
  type DerivedGgState,
  type GgToolBreakdown,
  type GgToolUsage,
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
  /** Every tool its instances called, most-used first. */
  tools: GgToolBreakdown;
  /**
   * How many tool calls the profile got out of each assistant response — every call its
   * instances made over every turn they took. Null when no instance took a turn.
   *
   * Summed rather than averaged across instances, for the same reason
   * {@link tokensPerSecond} is: a mean of per-instance rates weights a reviewer that took
   * one turn exactly as heavily as an implementer that took a hundred, so twelve
   * short-lived instances would decide a figure their work barely contributed to. The
   * profile's calls over the profile's responses is the question being asked.
   */
  toolCallsPerResponse: number | null;
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
 * Sum several instances' tool breakdowns into one: call counts and attributed result tokens
 * add up per tool, and the window total they are a share of adds up with them, so a
 * profile's per-tool share still reads against the material its instances actually carried.
 */
export function mergeToolBreakdowns(
  parts: readonly GgToolBreakdown[],
): GgToolBreakdown {
  const tools = new Map<string, GgToolUsage>();
  let totalContextTokens = 0;
  let outputTokensKnown = false;
  for (const part of parts) {
    totalContextTokens += part.totalContextTokens;
    outputTokensKnown = outputTokensKnown || part.outputTokensKnown;
    for (const tool of part.tools) {
      const at = tools.get(tool.name);
      if (!at) {
        tools.set(tool.name, { ...tool });
        continue;
      }
      at.calls += tool.calls;
      at.outputTokens += tool.outputTokens;
    }
  }
  const merged = [...tools.values()].sort(
    (a, b) =>
      b.calls - a.calls ||
      b.outputTokens - a.outputTokens ||
      a.name.localeCompare(b.name),
  );
  return {
    tools: merged,
    totalCalls: merged.reduce((sum, tool) => sum + tool.calls, 0),
    outputTokensKnown,
    totalContextTokens,
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
    const toolParts: GgToolBreakdown[] = [];
    const contextParts: GgContextAttribution[] = [];
    const statusCounts = { ...EMPTY_STATUS_COUNTS };
    const modelIds: string[] = [];
    const rows: GgAgentInstance[] = [];
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
      turns += state.turnCount;
      compactions += state.compactions.length;
      generated += generatedTokens(state.usage);
      modelMs += agentModelMs(state);
      pricedSlots.push(
        ...agentPricedSlots(state.slotUsage, state.usage, node.modelId),
      );
      toolParts.push(ggToolBreakdown(state));
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
    // Merged once and read twice: the profile's per-tool list, and the call rate taken
    // against the turns those same instances took (see `toolCallsPerResponse`).
    const tools = mergeToolBreakdowns(toolParts);
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
      usage,
      pricedSlots,
      cost: deriveGgCostBreakdown(pricedSlots, priceOf),
      peakFullness,
      peakTokens,
      meanPeakFullness: fullnessCount > 0 ? fullnessSum / fullnessCount : null,
      compactions,
      tokensPerSecond: modelMs > 0 ? generated / (modelMs / 1000) : null,
      tools,
      toolCallsPerResponse: toolCallsPerResponse(tools, turns),
      context: mergeGgAttributions(contextParts),
      modules: modules?.byProfile.get(name) ?? [],
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
