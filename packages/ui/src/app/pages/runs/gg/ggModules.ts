// A gg run read by **module instance** rather than by agent instance.
//
// gg's state does not belong to an agent. A module instance can be held by several agent instances at
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

import { useMemo } from "react";
import type {
  GgAgentStatus,
  GgAgentTransitionKind,
  GgCapabilitySet,
  GgMemoryScope,
  GgModuleKind,
  GgModuleOrigin,
} from "@test-cabinet/run-record/gg";
import {
  MODULE_CAPABILITY_IDS,
  agentProfile,
  agentProfileName,
  capabilityParam,
} from "./ggCatalog";
import { agentProfileId } from "./ggAgentAggregate";
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

/**
 * Whether one module instance serves one agent instance, one agent profile, or the run —
 * plus the fourth case a holder *count* alone always gets wrong.
 *
 * - `instance` — one holder, ever.
 * - `carried` — several holders, but only ever one of them at a time: a succession handed
 *   it on. It reads as sharing in a count and is not, and calling it sharing would invite a
 *   reader to take one instance's contents for a whole profile's.
 * - `agent` — several holders *at once*, all of one profile: agent-scoped state.
 * - `run` — several holders at once, spanning profiles (the board; a spawner's notebook a
 *   subagent of another profile inherits).
 *
 * Every one of these is read off {@link concurrentHolders} rather than off `holders.length`,
 * which is the whole difference between the first pair and the second.
 */
export type GgModuleScopeKind = "instance" | "carried" | "agent" | "run";

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
  /** The id of the agent profile that instance runs under — what this row joins on. */
  profileId: string;
  /** That profile's display name, for the chips and phrases that name it. */
  profile: string;
  status: GgAgentStatus;
  origin: GgModuleOrigin;
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
  /**
   * instance | carried | agent | run — derived from the {@link concurrentHolders}, never
   * from the declared scope and never from the raw holder count.
   */
  scopeKind: GgModuleScopeKind;
  /** The id of the profile it belongs to, when `scopeKind === "agent"`; null otherwise. */
  profileId: string | null;
  /** That profile's display name; null on the same terms as {@link profileId}. */
  profile: string | null;
  /** Created / carried / copied / linked / dropped, oldest first. */
  lifetime: GgModuleLifetimeEvent[];
  /**
   * Whether **every** holder has let go of it — the store itself is gone.
   *
   * Deliberately not "its last lifetime event was a drop": a `dropped` disposition is a
   * fact about one *outgoing instance*, and gg reports it whenever a successor's profile
   * does not enable the capability. The run-global board and a profile-scoped notebook are
   * held by every other instance at the same time, so reading one instance's release as the
   * store's end would badge a live board `(dropped)` for the rest of the run.
   */
  dropped: boolean;
  /**
   * The latest snapshot of its contents, or null for a kind that reports none (history) or
   * one nobody has touched.
   */
  content: ModuleSnapshot | null;
  /**
   * What it costs across its LIVE holders, per turn — the honest statement of "this shared
   * memory costs three running agents 4k each, every turn". Null when no live holder has a
   * cost to report.
   */
  totalCost: GgModuleCost | null;
}

/**
 * How one agent profile's instances are distributed over one kind's stores — the headline
 * of a profile's module row, and the whole distinction between state that belongs to the
 * *agent* and state that belongs to one of its instances.
 *
 * - `instance` — every instance that holds this kind holds a store of its own. There is
 *   nothing here that belongs to the profile, and any single rendering of "the agent's
 *   memories" would be a lie about eleven of its twelve instances.
 * - `agent` — they hold **one** store, all at once: agent-scoped state. What one instance
 *   writes, the next one reads, and the store's contents *are* the profile's.
 * - `carried` — one store, but held one instance at a time. A succession handed it on, so
 *   it looks like sharing in a holder count and is not: only ever one holder had it.
 * - `run` — the one store they share reaches beyond this profile (the board, or a notebook
 *   a spawner of another profile owns).
 * - `mixed` — several stores, at least one of them genuinely shared: some instances bound
 *   the shared one and some did not. The interesting failure.
 */
export type GgAgentModuleSharing =
  | "instance"
  | "agent"
  | "carried"
  | "run"
  | "mixed";

/** One store an agent profile's instances hold, and how many of them hold it. */
export interface GgAgentModuleHold {
  /** The store itself — so a surface can read its holders, lifetime and contents. */
  module: GgModuleInstance;
  /** How many of THIS profile's instances hold it (`module.holders` counts every holder). */
  holdersInProfile: number;
}

/**
 * A legal, ordinary disagreement between what a profile's configuration asked for and what
 * its instances actually got.
 *
 * Never an error: every divergence gg can produce here is a correct outcome of a
 * configuration that could not be honored literally (an `inherited` agent with no spawner
 * quietly gets its own store; a `shared` profile re-binds when a successor takes over). But
 * they are silent everywhere else, and they are exactly the thing that decides whether an
 * configuration ran the way it was written — so they are said out loud, with the cause.
 */
export interface GgModuleDivergence {
  /** What the configuration asked for. */
  declared: string;
  /** What the run actually did. */
  observed: string;
  /** Why that happens, in a sentence. */
  note: string;
}

/**
 * What a profile's configuration ASKED for about one module kind, with the params' own
 * defaults filled in — the declared half of every module question.
 *
 * Both fields are strings rather than unions because that is what a param is: an
 * unrecognized value falls back at launch and is reported as a warning, so a surface that
 * renders the declared value has to be able to render one gg did not recognize.
 */
export interface GgDeclaredModuleConfig {
  /** Which instance the module binds, for the one kind that has a scope (memories). */
  scope: string | null;
}

/** How one agent PROFILE's instances are distributed over one kind's module instances. */
export interface GgAgentModuleSummary {
  kind: GgModuleKind;
  /** The stores this profile's instances hold, most-held first. */
  instances: GgAgentModuleHold[];
  /** The row's headline — see {@link GgAgentModuleSharing}. */
  sharing: GgAgentModuleSharing;
  /** How many of the profile's instances hold this kind at all. */
  holdingInstances: number;
  /**
   * The one store every instance of this profile shares, when there is one — i.e. exactly
   * when `sharing === "agent"`. It is the only case whose contents can honestly be rendered
   * at the profile's grain, so the surfaces that do read it from here rather than deciding
   * for themselves.
   */
  agentScoped: GgModuleInstance | null;
  /**
   * What the profile's configuration asked for, with the params' own defaults filled in.
   * Null for a kind with no capability behind it (the window) and for a profile the
   * captured configuration does not declare, where there is nothing to have asked.
   */
  declared: GgDeclaredModuleConfig | null;
  /** Where the declaration and the run disagree — see {@link GgModuleDivergence}. */
  divergences: GgModuleDivergence[];
  /** Summed across the profile's instances' windows, per turn. */
  cost: GgModuleCost | null;
}

/** The projections the module surfaces need, from one traversal. */
export interface GgModuleIndex {
  byId: Map<string, GgModuleInstance>;
  /** Grouped by kind, in kind order, each group in first-seen order. Empty groups omitted. */
  byKind: Array<{ kind: GgModuleKind; instances: GgModuleInstance[] }>;
  /** What each agent instance holds, in kind order — the Instances tab's folder. */
  byAgent: Map<string, GgModuleInstance[]>;
  /**
   * What each agent PROFILE's instances hold, folded — the Agents tab's section. Keyed by
   * profile id, so two profiles sharing a name keep their own rows.
   */
  byProfile: Map<string, GgAgentModuleSummary[]>;
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

/**
 * Whether more than one agent instance held this module **at the same time**.
 *
 * Not `holders.length > 1`: a window carried across an `exec` has two holders and was never
 * shared, and an FSM run — where every state is a succession — would otherwise turn one
 * window into an N-holder "shared" store. See {@link concurrentHolders}.
 */
export function isShared(module: GgModuleInstance): boolean {
  return concurrentHolders(module).length > 1;
}

/**
 * Whether a store held several holders one after another rather than alongside one another
 * — a hand-off, not sharing.
 */
export function isCarried(module: GgModuleInstance): boolean {
  return module.holders.length > 1 && concurrentHolders(module).length <= 1;
}

/**
 * Whether a kind reports its contents at all.
 *
 * The window does not: it *is* the request, and it reports itself per turn as a context
 * breakdown rather than as a snapshot of a store. Every surface that counts stores "never
 * written to" has to ask this first — a window is by construction the fullest thing an
 * agent holds, and reporting all of them as empty inverts the one figure the module
 * surfaces exist to produce.
 */
export function moduleReportsContents(kind: GgModuleKind): boolean {
  return kind !== "history";
}

/**
 * The holders that hold the store *alongside* one another rather than one after another.
 *
 * A store gathers several holders in two entirely different ways, and telling them apart is
 * the whole difference between agent-scoped state and an ordinary succession. A `shared`
 * memory store is bound by every instance of a profile **at the same time** — four agents
 * curating one notebook. A window carried across an `exec` also ends up with two holders,
 * but only ever one of them held it: the successor took it and the predecessor let it go.
 * Both read as "2 holders", and only one of them is sharing.
 *
 * A [transferred](GgModuleOrigin) holder is precisely the one that *replaced* its
 * predecessor rather than joining it, so it is the one origin that adds no concurrent
 * holder. Every other origin — created, inherited, profile-bound, run-bound, forked-and-
 * linked — is a holder that joined the ones already there.
 */
export function concurrentHolders(module: GgModuleInstance): GgModuleHolder[] {
  return module.holders.filter((holder) => holder.origin !== "transferred");
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
  // The count that means "shared": how many held it at once, which for everything but a
  // succession is the whole holder set.
  const holders = concurrentHolders(module).length;
  const plural = holders === 1 ? "holder" : "holders";
  switch (module.scopeKind) {
    case "instance":
      return "held by one instance";
    case "carried":
      return `held one instance at a time, through ${module.holders.length} holders`;
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
      return `bound the store every ${module.profile ?? holder.profile} instance shares`;
    case "run":
      return "bound the run's one instance";
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

  for (const node of ordered) {
    const profileId = agentProfileId(node, capabilitySet);
    const profile = agentProfileName(capabilitySet, profileId);
    const state = perAgent.get(node.id);
    // An instance with no roster has simply not opened yet: in a live stream the module
    // `state_events` land before the `agent_modules` that names them, so several renders
    // happen with the node present and its roster still in flight.
    const held: GgModuleInstance[] = [];
    for (const entry of state?.modules ?? []) {
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
          profileId: null,
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
        profileId,
        profile,
        status: node.status,
        origin: entry.origin,
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
    // Sharing is a question about holders that held it AT ONCE, never about how many
    // holders it collected: a store handed to a successor has two and was never shared,
    // and every state of an FSM run is a succession. See {@link concurrentHolders}.
    const concurrent = concurrentHolders(module);
    const profiles = new Set(concurrent.map((holder) => holder.profileId));
    if (concurrent.length <= 1) {
      module.scopeKind = module.holders.length > 1 ? "carried" : "instance";
    } else if (profiles.size === 1) {
      module.scopeKind = "agent";
      module.profileId = concurrent[0]!.profileId;
      module.profile = concurrent[0]!.profile;
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
  // Which holders LET GO of which store. A `dropped` disposition names one outgoing
  // instance's release, never the store's end — the run-global board and a profile-scoped
  // notebook are held by every other instance at the same moment — so the release is
  // recorded per (store, holder) and the store is only gone once nobody is left in it.
  const released = new Map<string, Set<string>>();
  const release = (moduleId: string | null | undefined, agentId: string) => {
    if (!moduleId) return;
    const holders = released.get(moduleId) ?? new Set<string>();
    holders.add(agentId);
    released.set(moduleId, holders);
  };
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
          // Whatever it was handed, the predecessor is not holding it any more: the
          // successor took its place rather than joining it.
          release(entry.fromModuleId, transition.fromAgentId);
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
          release(entry.fromModuleId, transition.fromAgentId);
          break;
        }
        case "initialized": {
          // The successor's fresh instance is already `created` by its own roster; a second
          // row would say the same thing twice. What is worth a row is the OTHER half of the
          // same fact — the predecessor's store, which the successor declined to take and
          // which nobody carried anywhere.
          if (entry.fromModuleId && entry.fromModuleId !== entry.toModuleId) {
            byId.get(entry.fromModuleId)?.lifetime.push({
              ...base,
              kind: "dropped",
              toAgentId: null,
            });
            release(entry.fromModuleId, transition.fromAgentId);
          }
          break;
        }
        case "absent":
          break;
      }
    }
  }
  for (const module of byId.values()) {
    // A copied store's first holder IS the fork's child, so the synthesized `created` row
    // and the `copied` row describe one instant — and the transition is emitted on the
    // spawner's stream *before* the child's `agent_spawned`, so the copy would sort ahead of
    // the creation and the store would read as having been copied before it existed. The
    // `copied` row says strictly more (it names the store it came from), so it is the one
    // that survives. This is the same reason `initialized` never adds a row of its own.
    const bornAsCopy = module.lifetime.some(
      (event) =>
        event.kind === "copied" &&
        event.toAgentId === module.holders[0]?.agentId,
    );
    if (bornAsCopy) {
      module.lifetime = module.lifetime.filter(
        (event) => event.kind !== "created",
      );
    }
    module.lifetime.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    // Gone only once EVERY holder has let go — see {@link GgModuleInstance.dropped}.
    const gone = released.get(module.id);
    module.dropped =
      module.holders.length > 0 &&
      module.holders.every((holder) => gone?.has(holder.agentId) ?? false);
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
  // Instances grouped by the id of the profile they ran under, in tree order.
  const instancesByProfile = new Map<string, AgentTreeNode[]>();
  const walk = (node: AgentTreeNode) => {
    const profileId = agentProfileId(node, set);
    const list = instancesByProfile.get(profileId) ?? [];
    list.push(node);
    instancesByProfile.set(profileId, list);
    node.children.forEach(walk);
  };
  agentForest.forEach(walk);

  const out = new Map<string, GgAgentModuleSummary[]>();
  for (const [profileId, nodes] of instancesByProfile) {
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
      const instances: GgAgentModuleHold[] = [...counts.entries()]
        .flatMap(([id, holdersInProfile]) => {
          const module = byId.get(id);
          return module ? [{ module, holdersInProfile }] : [];
        })
        .sort(
          (a, b) =>
            b.holdersInProfile - a.holdersInProfile ||
            a.module.id.localeCompare(b.module.id),
        );

      const sharing = classifySharing(profileId, instances);
      // Only the one shape whose contents can honestly be shown at the profile's grain: one
      // store, held by every instance of the profile that holds this kind, all at once.
      const agentScoped =
        sharing === "agent" ? (instances[0]?.module ?? null) : null;
      const declared = declaredFor(set, profileId, kind);
      summaries.push({
        kind,
        instances,
        sharing,
        holdingInstances: instances.reduce(
          (sum, hold) => sum + hold.holdersInProfile,
          0,
        ),
        agentScoped,
        declared,
        divergences: moduleDivergences(declared, instances, holders),
        cost: sumCosts(holders.map((holder) => holder.cost)),
      });
    }
    out.set(profileId, summaries);
  }
  // A declared profile the run never instantiated still gets an (empty) entry, so a surface
  // iterating the configuration finds a row rather than a hole.
  for (const declared of set?.agents ?? []) {
    if (!out.has(declared.slug)) out.set(declared.slug, []);
  }
  return out;
}

// How one profile's instances stand to one kind's stores — see {@link GgAgentModuleSharing}.
//
// Everything turns on {@link concurrentHolders} rather than on the raw holder count: a store
// two instances held one after the other is not shared, however much a count says it is, and
// calling a succession "agent-scoped" would be the single most misleading thing this surface
// could say (it would invite a reader to treat one instance's contents as the profile's).
function classifySharing(
  profileId: string,
  holds: GgAgentModuleHold[],
): GgAgentModuleSharing {
  if (holds.length > 1) {
    // Several stores. The question is only whether any of them is genuinely shared: that is
    // the profile that half-bound its shared store, which is worth opening.
    return holds.some((hold) => concurrentHolders(hold.module).length > 1)
      ? "mixed"
      : "instance";
  }
  const hold = holds[0];
  if (!hold) return "instance";
  const { module } = hold;
  const concurrent = concurrentHolders(module);
  if (concurrent.length > 1) {
    // Shared. Whether it is the *agent's* turns on whether anybody outside the profile is in
    // it — a store the run's board or another profile's spawner also holds is not this
    // agent's state, it is the run's. Asked of the concurrent holders only: a predecessor of
    // another profile that handed the store on is not in it any more.
    return concurrent.every((holder) => holder.profileId === profileId)
      ? "agent"
      : "run";
  }
  return module.holders.length > 1 ? "carried" : "instance";
}

// What the profile's configuration asked for about this kind, or null where it asked
// nothing.
//
// Null in two cases, both of which matter: the window, which has no capability behind it (it
// is not something an agent is given, it is what an agent *is*), and a profile the captured
// configuration does not declare at all — a run recorded without its configuration, or an
// agent spawned under an id the set no longer carries. Reading `declaredModuleConfig`'s
// defaults for either would manufacture a declaration nobody made and then report the run
// diverging from it.
function declaredFor(
  set: GgCapabilitySet | null,
  profileId: string,
  kind: GgModuleKind,
): GgDeclaredModuleConfig | null {
  const capability = MODULE_CAPABILITY_IDS.get(kind);
  if (!capability) return null;
  const config = agentProfile(set, profileId);
  const declares = config?.capabilities.some(
    (entry) => entry.id === capability && entry.enabled,
  );
  return declares ? declaredModuleConfig(set, profileId, kind) : null;
}

// Where a profile's declaration and its instances' behaviour disagree.
//
// Each of these is a legal outcome — gg resolves an impossible scope by falling back rather
// than failing — and each is otherwise completely silent: the run reports the scope it was
// *asked* for whatever it then bound, which is exactly why the observed side of these
// surfaces had to be built. For the user's stated purpose (is this capability being used the
// way it was configured to be?) these lines are the highest-value thing on the tab.
function moduleDivergences(
  declared: GgDeclaredModuleConfig | null,
  holds: GgAgentModuleHold[],
  holders: GgModuleHolder[],
): GgModuleDivergence[] {
  if (!declared) return [];
  const out: GgModuleDivergence[] = [];

  switch (declared.scope) {
    case "shared":
      if (holds.length > 1) {
        out.push({
          declared: "shared",
          observed: `${holds.length} stores`,
          note:
            "A successor re-binds to its own profile's entry rather than carrying its " +
            "predecessor's, so an exec or an FSM transition part-way through a run leaves " +
            "the earlier store behind. Each instance still shares with the ones it ran " +
            "beside.",
        });
      }
      break;
    case "inherited":
    case "read-only":
      // The `MemoriesRuntime::resolve` fallback, which is invisible in the record: a holder
      // that inherited nothing still reports the scope it asked for.
      if (holders.every((holder) => holder.origin !== "inherited")) {
        out.push({
          declared: declared.scope,
          observed: "nothing inherited",
          note:
            "These instances have no spawner to inherit from — or their spawner organizes " +
            "its memories differently — so each one fell back to a store of its own.",
        });
      }
      break;
    case "isolated":
      if (holds.some((hold) => concurrentHolders(hold.module).length > 1)) {
        out.push({
          declared: "isolated",
          observed: "a store reached more than one instance",
          note:
            "The scope decides what an instance binds when it opens, not what it can be " +
            "given afterwards: a fork links its parent's store, and a transition hands one " +
            "on.",
        });
      }
      break;
    default:
      break;
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
 * Each field is read only where the kind's capability actually offers it, and is null
 * otherwise — see {@link GgDeclaredModuleConfig}. Filling in a default for a param an
 * operator cannot set would be worse than saying nothing: it would put a declaration in the
 * record that nobody made, and then let {@link moduleDivergences} report the run departing
 * from it.
 */
export function declaredModuleConfig(
  set: GgCapabilitySet | null,
  profileId: string,
  kind: GgModuleKind,
): GgDeclaredModuleConfig {
  const capability = MODULE_CAPABILITY_IDS.get(kind);
  // Read through `capabilityParam` rather than walking the profile again: where a param
  // lives is the catalog's business, and two readers of one fact are exactly the drift the
  // shared model layer exists to prevent.
  const read = (key: string): string | null => {
    const value = capability
      ? capabilityParam(set, profileId, capability, key)
      : null;
    return typeof value === "string" && value.trim() !== ""
      ? value.trim()
      : null;
  };
  return {
    scope: kind === "memories" ? (read("scope") ?? "isolated") : null,
  };
}
