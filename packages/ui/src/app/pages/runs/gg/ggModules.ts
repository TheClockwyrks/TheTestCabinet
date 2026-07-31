// A gg run read by **module instance** rather than by agent instance.
//
// gg's state used to belong to an agent: one agent, one memory store, one task list, one
// window. It does not any more. A module instance can be held by several agent instances at
// once (a profile-scoped memory store, a spawner's notebook a subagent inherits, the run's
// one board), carried whole from one instance to the next across an `exec` or an FSM
// transition, or copied when its holder forks. So a module is no longer a *property of* an
// agent — it is a thing in its own right, with its own holders and its own lifetime.
//
// Every other view of a run is per agent instance, which is the right shape for "what did
// agent-7 do" and the wrong one for the questions this module exists to answer:
//
//   - Which instances share this store? (and are any of them still running?)
//   - Is this holder's copy owned — in its prompt every turn — or merely reachable?
//   - When was it created, carried, copied, linked, dropped?
//   - What does it cost the windows it is in?
//   - Did the configuration's declared scope actually resolve the way it asked?
//
// None of those can be answered from a per-agent fold, because the answers span agents. So
// this folds the run the other way: index every module instance by its id, attach every
// agent instance that ever held it, and derive scope, lifetime and cost from the holder set
// rather than from what any configuration claimed.
//
// # Where the facts come from
//
// The load-bearing input is the per-instance **roster** (`agent_modules`), which every
// incarnation emits as it opens: one row per module kind naming the backing store it is a
// holder of. Two instances reporting one id are holding one store — that is the whole
// mechanism, and it needs no inference, no walking of the spawn tree, and no scope
// heuristics. The transitions (`agent_transition`) supply the lifetime, and the per-module
// snapshots (`DerivedGgState.moduleSnapshots`) supply the contents.
//
// # Records written before module identity existed
//
// Such a stream carries no rosters at all. Rather than going blank, this synthesizes one
// private instance per (agent, enabled capability) with a `legacy:` id — so every surface
// degrades to exactly today's per-agent behaviour, which is the difference between an old
// run still being readable and not.

import { useMemo } from "react";
import type {
  GgAgentModule,
  GgAgentStatus,
  GgAgentTransitionKind,
  GgCapabilitySet,
  GgMemoryScope,
  GgModuleKind,
  GgModuleOrigin,
  GgModuleOwnership,
} from "@test-cabinet/run-record/gg";
import {
  MODULE_CAPABILITY_IDS,
  agentCapabilityOn,
  agentProfile,
} from "./ggCatalog";
import { agentProfileName } from "./ggAgentAggregate";
import type {
  AgentTransition,
  AgentTreeNode,
  DerivedGgState,
  ModuleSnapshot,
} from "./useGgRunState";

/** Every module kind, in the contract's own order (`GgModuleKind::ALL`). */
export const MODULE_KIND_ORDER: readonly GgModuleKind[] = [
  "history",
  "memories",
  "tasks",
  "board",
  "skills",
  "archive",
];

/** Whether one module instance serves one agent instance, one agent profile, or the run. */
export type GgModuleScopeKind = "instance" | "agent" | "run";

/**
 * What one module instance costs one holder's window, per turn.
 *
 * A module's band is re-sent on **every** request the holder makes, so "what it costs" is a
 * per-turn rent rather than a one-off — which is exactly the figure that decides whether a
 * capability is earning its keep.
 */
export interface GgModuleCost {
  /** The band's size in the holder's most recent window snapshot. */
  latestTokens: number;
  /** The largest it ever was in that window. */
  peakTokens: number;
  /** Its share of the whole window, latest — `null` when the window reported no total. */
  share: number | null;
}

/** One agent instance's hold on one module instance. */
export interface GgModuleHolder {
  agentId: string;
  /** The agent profile that instance runs under. */
  profile: string;
  status: GgAgentStatus;
  origin: GgModuleOrigin;
  ownership: GgModuleOwnership;
  writable: boolean;
  /** The holder's DECLARED memory scope, for the one kind that has one; null otherwise. */
  scope: GgMemoryScope | null;
  /** When it began holding — the instance's first event timestamp. */
  since: string | null;
  /**
   * What the module's band costs THIS holder's window. Null for a kind with no band of its
   * own (the archive, which is by definition out of the window) and for a holder whose
   * window never reported a breakdown.
   */
  cost: GgModuleCost | null;
}

/**
 * One event in a module instance's life, oldest first.
 *
 * `created` is synthesized at its first holder's arrival; everything else comes from an
 * `agent_transition`, which is the only thing that moves a module between instances.
 */
export interface GgModuleLifetimeEvent {
  kind: "created" | "carried" | "copied" | "linked" | "dropped";
  timestamp: string;
  /** The instance it moved FROM; null for a creation. */
  fromAgentId: string | null;
  /** The instance it moved TO; null for a drop. */
  toAgentId: string | null;
  /** The succession that produced it (exec / fork / fsm); null for a spawn-time bind. */
  via: GgAgentTransitionKind | null;
  /** For a `copied` event, the instance the contents were copied FROM. */
  copiedFromModuleId?: string;
}

/** One module instance: what it is, who holds it, what happened to it, what it holds. */
export interface GgModuleInstance {
  id: string;
  kind: GgModuleKind;
  /** Every instance that ever held it, in first-seen order. */
  holders: GgModuleHolder[];
  /** Holders whose instance has not finished — "who is reading this right now". */
  liveHolders: GgModuleHolder[];
  /** instance | agent | run — derived from the holders, never from the declared scope. */
  scopeKind: GgModuleScopeKind;
  /** The profile it belongs to, when `scopeKind === "agent"`; null otherwise. */
  profile: string | null;
  /** Created / carried / copied / linked / dropped, oldest first. */
  lifetime: GgModuleLifetimeEvent[];
  /** Whether its last lifetime event was a drop — the store is gone. */
  dropped: boolean;
  /**
   * The latest snapshot of its contents, or null for a kind that reports none (history) or
   * one whose holders never emitted (a legacy record, or a store nobody touched).
   */
  content: ModuleSnapshot | null;
  /**
   * What it costs across its LIVE holders, per turn — the honest statement of "this shared
   * memory costs three running agents 4k each, every turn". Null when no live holder has a
   * cost to report.
   */
  totalCost: GgModuleCost | null;
}

/** How one agent PROFILE's instances are distributed over one kind's module instances. */
export interface GgAgentModuleSummary {
  kind: GgModuleKind;
  /** The instances this profile's instances hold, most-held first. */
  instances: Array<{
    id: string;
    holdersInProfile: number;
    totalHolders: number;
  }>;
  /**
   * The row's headline. `instance` — every instance of the profile has its own; `agent` —
   * they all share one; `run` — the one they share reaches beyond this profile; `mixed` —
   * some share and some do not, which is the interesting failure.
   */
  sharing: "instance" | "agent" | "run" | "mixed";
  /** What this profile's instances actually reported holding it as, when they agree. */
  observedOwnership: GgModuleOwnership | null;
  /** The declared scope its instances reported, when they agree; null otherwise. */
  observedScope: GgMemoryScope | null;
  /** Summed across the profile's instances, and the per-instance mean. */
  cost: GgModuleCost | null;
}

/** The projections the module surfaces need, from one traversal. */
export interface GgModuleIndex {
  byId: Map<string, GgModuleInstance>;
  /** Grouped by kind, in kind order, each group in first-seen order. Empty groups omitted. */
  byKind: Array<{ kind: GgModuleKind; instances: GgModuleInstance[] }>;
  /** What each agent instance holds, in kind order — the Instances tab's folder. */
  byAgent: Map<string, GgModuleInstance[]>;
  /** What each agent PROFILE's instances hold, folded — the Agents tab's section. */
  byProfile: Map<string, GgAgentModuleSummary[]>;
  /**
   * Whether the run reported rosters at all. False on a record written before module
   * identity existed, whose instances are synthesized — a surface can then soften its
   * language ("this run predates module identity") rather than asserting things it inferred.
   */
  identified: boolean;
}

// The context band each kind occupies, for the cost attribution. The archive has none —
// it is out of the window by definition — and history is the whole window rather than a
// band of it, both of which are handled explicitly below.
const BAND_BY_KIND: Partial<Record<GgModuleKind, string>> = {
  memories: "memory",
  tasks: "task_list",
  board: "board",
  skills: "skill",
};

/** The label a surface names a module kind by. */
export function moduleKindLabel(kind: GgModuleKind): string {
  switch (kind) {
    case "history":
      return "History";
    case "memories":
      return "Memories";
    case "tasks":
      return "Tasks";
    case "board":
      return "Board";
    case "skills":
      return "Skills";
    case "archive":
      return "Archive";
  }
}

/** Whether more than one agent instance ever held this module. */
export function isShared(module: GgModuleInstance): boolean {
  return module.holders.length > 1;
}

/** The holders of `module` other than `agentId`'s, in first-seen order. */
export function coHolders(
  module: GgModuleInstance,
  agentId: string,
): GgModuleHolder[] {
  return module.holders.filter((holder) => holder.agentId !== agentId);
}

/** How a module instance's sharing reads in one phrase. */
export function moduleScopeLabel(module: GgModuleInstance): string {
  const holders = module.holders.length;
  const plural = holders === 1 ? "holder" : "holders";
  switch (module.scopeKind) {
    case "instance":
      return "held by one instance";
    case "agent":
      return `shared by ${holders} ${plural} of ${module.profile ?? "one agent"}`;
    case "run":
      return `shared by ${holders} ${plural} across the run`;
  }
}

/** How one holder came by its module, in one phrase. */
export function moduleOriginLabel(
  module: GgModuleInstance,
  holder: GgModuleHolder,
): string {
  switch (holder.origin) {
    case "created":
      return "created it";
    case "inherited": {
      // Whom from: the holder that had it first, which is the one that created it.
      const source = module.holders[0];
      return source && source.agentId !== holder.agentId
        ? `inherited from ${source.agentId}`
        : "inherited from its spawner";
    }
    case "profile":
      return `bound the ${module.profile ?? holder.profile} instance`;
    case "run":
      return "bound the run's instance";
    case "transferred": {
      const carried = module.lifetime.find(
        (event) =>
          event.kind === "carried" && event.toAgentId === holder.agentId,
      );
      return carried?.fromAgentId
        ? `carried from ${carried.fromAgentId}`
        : "carried from its predecessor";
    }
    case "forked": {
      const copied = module.lifetime.find(
        (event) =>
          (event.kind === "copied" || event.kind === "linked") &&
          event.toAgentId === holder.agentId,
      );
      return copied?.fromAgentId
        ? `received when ${copied.fromAgentId} was forked`
        : "received in a fork";
    }
  }
}

// --- The derivation ----------------------------------------------------------

// What a module's band costs one holder's window: the latest breakdown's figure for the
// band, the largest it ever was across the series, and its share of the whole window.
// History is the whole window rather than a band of it; the archive has no band at all.
function holderCost(
  kind: GgModuleKind,
  state: DerivedGgState | undefined,
): GgModuleCost | null {
  if (!state?.latestContext) return null;
  if (kind === "archive") return null;
  if (kind === "history") {
    const peak = state.contextSeries.reduce(
      (max, snapshot) => Math.max(max, snapshot.totalTokens),
      0,
    );
    return {
      latestTokens: state.latestContext.totalTokens,
      peakTokens: peak,
      // A window's share of itself is not a figure; the fullness graph is where that
      // question is answered.
      share: null,
    };
  }
  const band = BAND_BY_KIND[kind];
  if (!band) return null;
  const at = (snapshot: {
    bySource: Array<{ source: string; tokens: number }>;
  }) => snapshot.bySource.find((usage) => usage.source === band)?.tokens ?? 0;
  const latestTokens = at(state.latestContext);
  const peakTokens = state.contextSeries.reduce(
    (max, snapshot) => Math.max(max, at(snapshot)),
    latestTokens,
  );
  const total = state.latestContext.totalTokens;
  return {
    latestTokens,
    peakTokens,
    share: total > 0 ? latestTokens / total : null,
  };
}

// Sum a set of per-holder costs into one figure. `peakTokens` is summed rather than maxed
// for the same reason `latestTokens` is: three holders each paying 4k are paying 12k.
function sumCosts(costs: Array<GgModuleCost | null>): GgModuleCost | null {
  const present = costs.filter((cost): cost is GgModuleCost => cost !== null);
  if (present.length === 0) return null;
  return {
    latestTokens: present.reduce((sum, cost) => sum + cost.latestTokens, 0),
    peakTokens: present.reduce((sum, cost) => sum + cost.peakTokens, 0),
    // A summed share would be a share of several different windows, which is not a number.
    share: present.length === 1 ? present[0]!.share : null,
  };
}

// The roster an instance reported, or — for a record written before rosters existed — one
// synthesized from what its profile's capabilities say it must have held. The synthetic ids
// are private per (agent, kind), which is exactly the shape module state had back then.
function rosterFor(
  node: AgentTreeNode,
  profile: string,
  state: DerivedGgState | undefined,
  set: GgCapabilitySet | null,
): GgAgentModule[] {
  const reported = state?.modules ?? [];
  if (reported.length > 0) return reported;
  return MODULE_KIND_ORDER.filter((kind) => {
    const capability = MODULE_CAPABILITY_IDS.get(kind);
    // Every agent has a window, always; the rest are their capability's.
    return capability == null || agentCapabilityOn(set, profile, capability);
  }).map((kind) => ({
    kind,
    moduleId: `legacy:${node.id}:${kind}`,
    enabled: true,
    ownership: "owned" as GgModuleOwnership,
    origin: "created" as GgModuleOrigin,
    // The one thing a legacy record does carry: the scope its memory snapshots reported.
    scope:
      kind === "memories" && state?.memory?.scope
        ? (state.memory.scope as GgMemoryScope)
        : undefined,
    writable: kind === "memories" ? (state?.memory?.writable ?? true) : true,
  }));
}

// The transitions in stream order, deduplicated. A transition is emitted once, on the
// outgoing instance's stream, so the global list is already the run's — but the per-agent
// slices carry the same events, and folding both would double every lifetime row.
function orderedTransitions(
  transitions: readonly AgentTransition[],
): AgentTransition[] {
  const seen = new Set<string>();
  const out: AgentTransition[] = [];
  for (const transition of transitions) {
    const key = `${transition.fromAgentId}→${transition.toAgentId}:${transition.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(transition);
  }
  return out;
}

/**
 * Fold a run into its module instances — see the module docs.
 *
 * Every derivation is over **observed** facts: the holder set comes from the rosters, the
 * scope kind from the holder set, the lifetime from the transitions. Nothing is inferred
 * from the declared configuration, because the declared configuration is the thing these
 * surfaces exist to audit.
 */
export function deriveGgModules(
  capabilitySet: GgCapabilitySet | null,
  agentForest: readonly AgentTreeNode[],
  perAgent: ReadonlyMap<string, DerivedGgState>,
  transitions: readonly AgentTransition[],
  moduleSnapshots: ReadonlyMap<string, ModuleSnapshot>,
): GgModuleIndex {
  // The forest in tree order — root first, each subagent after its spawner — so an
  // instance's holders list in the order the run introduced them.
  const ordered: AgentTreeNode[] = [];
  const walk = (node: AgentTreeNode) => {
    ordered.push(node);
    node.children.forEach(walk);
  };
  agentForest.forEach(walk);

  const byId = new Map<string, GgModuleInstance>();
  const byAgent = new Map<string, GgModuleInstance[]>();
  let identified = false;

  for (const node of ordered) {
    const profile = agentProfileName(node, capabilitySet);
    const state = perAgent.get(node.id);
    if ((state?.modules?.length ?? 0) > 0) identified = true;
    const held: GgModuleInstance[] = [];
    for (const entry of rosterFor(node, profile, state, capabilitySet)) {
      // A disabled module has no store, so there is nothing to be a holder of.
      if (!entry.enabled || !entry.moduleId) continue;
      let module = byId.get(entry.moduleId);
      if (!module) {
        module = {
          id: entry.moduleId,
          kind: entry.kind,
          holders: [],
          liveHolders: [],
          scopeKind: "instance",
          profile: null,
          lifetime: [],
          dropped: false,
          content: moduleSnapshots.get(entry.moduleId) ?? null,
          totalCost: null,
        };
        byId.set(entry.moduleId, module);
      }
      const holder: GgModuleHolder = {
        agentId: node.id,
        profile,
        status: node.status,
        origin: entry.origin,
        ownership: entry.ownership,
        writable: entry.writable,
        scope: entry.scope ?? null,
        since: node.startedAt ?? null,
        cost: holderCost(entry.kind, state),
      };
      module.holders.push(holder);
      held.push(module);
    }
    byAgent.set(node.id, held);
  }

  // Scope, live holders and cost — all read off the holder set, which is the point.
  for (const module of byId.values()) {
    module.liveHolders = module.holders.filter(
      (holder) => holder.status === "running" || holder.status === "blocked",
    );
    const profiles = new Set(module.holders.map((holder) => holder.profile));
    if (module.holders.length <= 1) {
      module.scopeKind = "instance";
    } else if (profiles.size === 1) {
      module.scopeKind = "agent";
      module.profile = module.holders[0]!.profile;
    } else {
      module.scopeKind = "run";
    }
    // What it costs the agents that are still running. A finished holder's window is not
    // being re-sent, so counting it would answer a question about the past as if it were
    // about the present; when nothing is live the whole holder set stands in, which is what
    // a finished run wants.
    const source =
      module.liveHolders.length > 0 ? module.liveHolders : module.holders;
    module.totalCost = sumCosts(source.map((holder) => holder.cost));
  }

  // The lifetime. Seeded with a creation at the first holder's arrival, then one row per
  // transition mentioning the instance — which is what makes a family of forked stores
  // walkable in either direction.
  for (const module of byId.values()) {
    const first = module.holders[0];
    if (first) {
      module.lifetime.push({
        kind: "created",
        timestamp: first.since ?? "",
        fromAgentId: null,
        toAgentId: first.agentId,
        via: null,
      });
    }
  }
  for (const transition of orderedTransitions(transitions)) {
    for (const entry of transition.modules) {
      const base = {
        timestamp: transition.timestamp,
        fromAgentId: transition.fromAgentId,
        toAgentId: transition.toAgentId,
        via: transition.kind,
      };
      switch (entry.disposition) {
        case "carried": {
          const module = entry.toModuleId
            ? byId.get(entry.toModuleId)
            : undefined;
          module?.lifetime.push({ ...base, kind: "carried" });
          // A store swap: the successor is holding a DIFFERENT instance than the one it was
          // handed, which is a legal outcome of a `shared` scope and worth reading as the
          // predecessor's instance being let go of.
          if (entry.fromModuleId && entry.fromModuleId !== entry.toModuleId) {
            byId.get(entry.fromModuleId)?.lifetime.push({
              ...base,
              kind: "dropped",
              toAgentId: null,
            });
          }
          break;
        }
        case "copied": {
          if (!entry.toModuleId) break;
          byId.get(entry.toModuleId)?.lifetime.push({
            ...base,
            kind: "copied",
            copiedFromModuleId: entry.fromModuleId ?? undefined,
          });
          break;
        }
        case "linked": {
          if (!entry.toModuleId) break;
          byId
            .get(entry.toModuleId)
            ?.lifetime.push({ ...base, kind: "linked" });
          break;
        }
        case "dropped": {
          if (!entry.fromModuleId) break;
          byId
            .get(entry.fromModuleId)
            ?.lifetime.push({ ...base, kind: "dropped", toAgentId: null });
          break;
        }
        case "initialized": {
          // The successor's fresh instance is already `created` by its own roster; a second
          // row would say the same thing twice.
          break;
        }
        case "absent":
          break;
      }
    }
  }
  for (const module of byId.values()) {
    module.lifetime.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    module.dropped =
      module.lifetime[module.lifetime.length - 1]?.kind === "dropped";
  }

  // Grouped by kind, in kind order, each group in first-seen order. An empty group is
  // omitted rather than shown: "none of these" reads better as an absence than as a heading
  // with nothing under it.
  const byKind = MODULE_KIND_ORDER.map((kind) => ({
    kind,
    instances: [...byId.values()].filter((module) => module.kind === kind),
  })).filter((group) => group.instances.length > 0);

  return {
    byId,
    byKind,
    byAgent,
    byProfile: foldByProfile(byId, byAgent, agentForest, capabilitySet),
    identified,
  };
}

// How each declared (and each observed) profile's instances are distributed over module
// instances, per kind. This is the Agents tab's question — *does one store serve all twelve
// instances of this profile, or twelve?* — and it is a pure regrouping of the index.
function foldByProfile(
  byId: ReadonlyMap<string, GgModuleInstance>,
  byAgent: ReadonlyMap<string, GgModuleInstance[]>,
  agentForest: readonly AgentTreeNode[],
  set: GgCapabilitySet | null,
): Map<string, GgAgentModuleSummary[]> {
  // Instances grouped by the profile they ran under, in tree order.
  const instancesByProfile = new Map<string, AgentTreeNode[]>();
  const walk = (node: AgentTreeNode) => {
    const profile = agentProfileName(node, set);
    const list = instancesByProfile.get(profile) ?? [];
    list.push(node);
    instancesByProfile.set(profile, list);
    node.children.forEach(walk);
  };
  agentForest.forEach(walk);

  const out = new Map<string, GgAgentModuleSummary[]>();
  for (const [profile, nodes] of instancesByProfile) {
    const summaries: GgAgentModuleSummary[] = [];
    for (const kind of MODULE_KIND_ORDER) {
      // Every hold this profile's instances have on this kind, and by whom.
      const counts = new Map<string, number>();
      const holders: GgModuleHolder[] = [];
      for (const node of nodes) {
        for (const module of byAgent.get(node.id) ?? []) {
          if (module.kind !== kind) continue;
          counts.set(module.id, (counts.get(module.id) ?? 0) + 1);
          const holder = module.holders.find((h) => h.agentId === node.id);
          if (holder) holders.push(holder);
        }
      }
      if (counts.size === 0) continue;
      const instances = [...counts.entries()]
        .map(([id, holdersInProfile]) => ({
          id,
          holdersInProfile,
          totalHolders: byId.get(id)?.holders.length ?? holdersInProfile,
        }))
        .sort(
          (a, b) =>
            b.holdersInProfile - a.holdersInProfile || a.id.localeCompare(b.id),
        );

      // The sharing headline. One store the profile's instances all bind and nobody else
      // does is `agent`; one that reaches beyond the profile is `run`; several stores where
      // one of them is shared is `mixed`, which is the interesting failure.
      const shared = instances.filter((entry) => entry.totalHolders > 1);
      let sharing: GgAgentModuleSummary["sharing"];
      if (instances.length === 1 && instances[0]!.totalHolders > 1) {
        sharing =
          instances[0]!.holdersInProfile === instances[0]!.totalHolders
            ? "agent"
            : "run";
      } else if (instances.length === 1) {
        sharing = nodes.length > 1 ? "agent" : "instance";
      } else {
        sharing = shared.length > 0 ? "mixed" : "instance";
      }

      const agree = <T>(values: T[]): T | null => {
        const distinct = new Set(values);
        return distinct.size === 1 ? values[0]! : null;
      };
      summaries.push({
        kind,
        instances,
        sharing,
        observedOwnership: agree(holders.map((holder) => holder.ownership)),
        observedScope: agree(holders.map((holder) => holder.scope)),
        cost: sumCosts(holders.map((holder) => holder.cost)),
      });
    }
    out.set(profile, summaries);
  }
  // A declared profile the run never instantiated still gets an (empty) entry, so a surface
  // iterating the configuration finds a row rather than a hole.
  for (const declared of set?.agents ?? []) {
    if (!out.has(declared.name)) out.set(declared.name, []);
  }
  return out;
}

/** The run's module index, memoized — see {@link deriveGgModules}. */
export function useGgModules(
  capabilitySet: GgCapabilitySet | null,
  agentForest: readonly AgentTreeNode[],
  perAgent: ReadonlyMap<string, DerivedGgState>,
  transitions: readonly AgentTransition[],
  moduleSnapshots: ReadonlyMap<string, ModuleSnapshot>,
): GgModuleIndex {
  return useMemo(
    () =>
      deriveGgModules(
        capabilitySet,
        agentForest,
        perAgent,
        transitions,
        moduleSnapshots,
      ),
    [capabilitySet, agentForest, perAgent, transitions, moduleSnapshots],
  );
}

/**
 * The declared half of a profile's module configuration: what its capability params ASKED
 * for, as against what {@link deriveGgModules} observes it got.
 *
 * Returned as strings because that is what a param is — an unrecognized value falls back at
 * launch and is reported as a warning, so a surface that renders the declared value has to be
 * able to render one gg did not recognize.
 */
export function declaredModuleConfig(
  set: GgCapabilitySet | null,
  profile: string,
  kind: GgModuleKind,
): { ownership: string; scope: string | null } {
  const capability = MODULE_CAPABILITY_IDS.get(kind);
  const params = capability
    ? (agentProfile(set, profile)?.capabilities.find((c) => c.id === capability)
        ?.params as Record<string, unknown> | undefined)
    : undefined;
  const read = (key: string): string | null => {
    const value = params?.[key];
    return typeof value === "string" && value.trim() !== ""
      ? value.trim()
      : null;
  };
  return {
    // Both params default when absent, and the defaults are what every configuration
    // written before they existed has.
    ownership: read("ownership") ?? "owned",
    scope: kind === "memories" ? (read("scope") ?? "isolated") : null,
  };
}
