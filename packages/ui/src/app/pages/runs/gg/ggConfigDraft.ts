// The editable form of a gg configuration, and the conversions between it and the
// wire `GgCapabilitySet`.
//
// A gg run is configured by a capability set, not by a harness/model/orchestrator
// tuple — and its capabilities are **per agent**: the set declares one or more agent
// profiles (the first is always the Root), each with its own enabled capabilities,
// model binding, custom prompt, and the set of other agents it may spawn. A *named
// capability set* is what an operator registers (the account section's gg tab,
// persisted per-account by the backend) and what the new-run form launches. This
// module owns the draft shape the editor works in, the built-in configurations every
// operator starts with, and the (de)serialization so the editor and the launcher
// never drift on what a saved configuration means.
//
// The draft keeps param values — and the run's execution ceilings — as *typed text*
// rather than parsed JSON or numbers, so an in-progress, not-yet-valid edit survives
// a re-render (and a save round-trip) instead of being silently dropped, and so an
// empty ceiling field stays distinguishable from a ceiling deliberately set to zero.
//
// Everything the draft refers to internally — an agent an allowlist entry points at, an
// agent a capability param names, the model slot an agent binds — is referred to by a
// **local id** ([localId]), never by the name shown in the form. The wire format is
// name-keyed (gg puts an agent to work by name and labels a launch input by slot name),
// so those names are resolved on the way out and re-resolved to ids on the way in. That
// is what makes a rename a rename: renaming an agent or a model slot in the editor moves
// every reference with it instead of quietly orphaning the ones that spelled the old
// name. The ids are editor-only and per-session; nothing persists them.

import type {
  GgAgentConfig,
  GgCapabilityConfig,
  GgCapabilitySet,
  GgHook,
  GgHookEvent,
  GgLoopDetection,
  GgModelSlot,
  GgModuleKind,
  GgPromptCacheTtl,
  GgRunLimits,
  GgSubagentRef,
  GgSubagentScope,
} from "@test-cabinet/run-record/gg";
import {
  BYTES_PER_MIB,
  CAPABILITIES,
  GG_BUILTIN_HOOK_IDS,
  DEFAULT_CAP_IDS,
  type GgHookScope,
  FSM_CAP_ID,
  FSM_STATES_PARAM,
  LOOP_DETECTION_SPECS,
  MODULE_KINDS,
  PRIMARY_SLOT,
  RESPONSES_AS_CODE_CAP_ID,
  ROOT_AGENT,
  RUN_LIMIT_SPECS,
  SUBAGENT_SCOPES,
  capabilityAppliesToMode,
  capabilitySpec,
  hookScopeOf,
  isModeCapability,
  type CapSpec,
  type GgAgentMode,
  type LoopDetectionSpec,
  type ParamSpec,
} from "./ggCatalog";

// One capability's draft state. `enabled` toggles the capability on/off;
// `implementation` is the selected swappable implementation (the A/B lever —
// empty = the capability's default); and `params` holds the values of the
// capability's dedicated param controls keyed by param name (string form, empty =
// unset).
//
// `extraParams` is not editable in the form: it carries, verbatim, any param a
// *stored* configuration had that no dedicated control covers, so reopening and
// re-saving a configuration never silently drops a param gg might still read.
export interface GgCapabilityDraft {
  enabled: boolean;
  implementation?: string;
  params?: Record<string, string>;
  extraParams?: Record<string, unknown>;
}

// A fresh local id. Local ids exist only inside an editing session: they give an agent
// profile and a model slot an identity independent of the name shown in the form, so a
// rename cannot orphan the references to them. Nothing serializes them, so a plain
// monotonic counter is identity enough — two drafts alive at once never share one.
let localIdCounter = 0;
export function localId(prefix: string): string {
  localIdCounter += 1;
  return `${prefix}-${localIdCounter}`;
}

// One declared **model slot** as the editor holds it: a launch-time model parameter
// with an optional default the new-run form pre-fills. Declaring these is what makes
// one saved configuration reusable across models — the operator supplies the models
// at launch instead of the configuration baking them in.
export interface GgModelSlotDraft {
  // Editor-only identity: what an agent's binding points at, so renaming a slot carries
  // every agent bound to it along instead of orphaning them. Never serialized — the
  // wire format names slots.
  id: string;
  name: string;
  defaultModelId: string;
}

// Where an agent gets its model: from a declared model slot (supplied at launch) or
// pinned here, in the configuration, for every run of it.
export type GgAgentModelSource = "model-slot" | "model";

// One entry in an agent's delegation allowlist as the editor holds it: a target agent
// this agent may spawn (may be itself), plus the caller-scoped description that tells
// the spawning agent when to use it.
export interface GgSubagentDraft {
  // The target agent's [local id](localId) — not its name, so renaming the target keeps
  // the entry pointed at it.
  agentId: string;
  description: string;
  // What this agent may use the target **for**. An entry with no scopes is dropped on
  // serialize — the editor removes a roster row by clearing its last scope rather than
  // by a separate delete, so "listed but usable for nothing" is never a state to save.
  scopes: GgSubagentScope[];
}

// One **agent profile** as the editor holds it: its name, its per-capability drafts
// (keyed by capability id), its single model binding (deferred to a declared model
// slot, or pinned here), its per-tool ablation, its custom prompt bits, and the
// agents its roster names (and what each may be used for).
//
// `systemPromptTemplate` is empty when this agent uses gg's built-in template; a
// non-empty value is a full override. The editor blanks it back to `""` when it
// matches the built-in default, so an unedited override is not stored.
//
// Everything from `modelSource` down describes a **worker**. A machine
// ([isFsmShell](isFsmShell)) is not one — it takes no turns, so it runs no model, renders
// no prompt and spawns from no roster — and for one of those the fields below are shown by
// no control, written to no capability set ([agentConfigFromDraft]) and returned to their
// defaults when the agent is committed ([resetAgentForMode]), exactly as another type's
// capabilities are.
export interface GgAgentDraft {
  // Editor-only identity, stable across every rename. Which profile is the **root** is
  // a flag on the configuration ([GgConfigDraft.rootAgentId]) holding this id, so no
  // part of the editor decides it by looking for a particular name.
  id: string;
  name: string;
  // How this agent is implemented. The wire format has no field for it — it records the
  // type as the two [mode-marker](isModeCapability) capabilities — so this is derived on
  // the way in and written back out as those two flags. It is held explicitly rather than
  // read off the capability map because the map must be free to keep what the *other*
  // types were configured with: switching type and back inside one editing session is
  // not an edit, and must lose nothing.
  mode: GgAgentMode;
  // Every catalog capability's draft, whether or not this agent's type reads it. The
  // ones its type does not read are the session's scratch space: they are shown by no
  // control, written to no capability set ([agentConfigFromDraft]), and returned to the
  // catalog's defaults whenever the agent is committed or reloaded
  // ([resetAgentForMode]).
  capabilities: Record<string, GgCapabilityDraft>;
  modelSource: GgAgentModelSource;
  // The [id](GgModelSlotDraft.id) of the model slot this agent defers to, or empty when
  // it defers to none (a pinned binding, or a slot that was deleted out from under it).
  modelSlotId: string;
  modelId: string;
  disabledTools: string[];
  customInstructions: string;
  systemPromptTemplate: string;
  // How long this agent asks the provider to keep its stable prompt-cache entries. Held
  // as the wire value itself (there is nothing to parse), and "standard" — the provider
  // default, and the only one that costs no premium — is what an agent that never touched
  // the knob saves as: no key at all.
  promptCacheTtl: GgPromptCacheTtl;
  // Whether gg watches this agent's replies for a generation loop, and with what knobs.
  loopDetection: GgLoopDetectionDraft;
  subagents: GgSubagentDraft[];
  // This agent's own [hooks](GgHook) — the eight events that fire because *this* agent
  // wrote a file, ran a command, compacted, started or stopped. The run's own two
  // (session start/end) are not here; they are the configuration's ([GgConfigDraft.hooks]),
  // because they happen once per run rather than for any one agent.
  hooks: GgHookDraft[];
}

// One agent's loop detection as the editor holds it: the switch as a boolean, and one
// *string* per knob keyed by its wire field.
//
// Strings for the same reason the run's ceilings are strings ([GgRunLimitsDraft]): an
// empty field ("take gg's default") has to stay distinguishable from a deliberate `0`,
// and two of these knobs read `0` as a real setting — `minSaturatedRun: 0` is the
// unmodified frequency rule and `maxResponseChars: 0` turns the length backstop off. A
// number-typed draft would collapse both onto "unset" the moment the field was cleared.
//
// A total record over the contract's own optional fields, so a knob added to
// `GgLoopDetection` is a compile error in every function below rather than a setting the
// form silently drops on a round-trip.
export interface GgLoopDetectionDraft {
  enabled: boolean;
  knobs: Record<LoopDetectionSpec["key"], string>;
}

/**
 * Loop detection as an agent that has never touched it holds it: off, with every knob at
 * gg's default (an empty field). This is also what a stored configuration that declares
 * none loads as, and what such an agent saves back as — no key at all.
 */
export function blankLoopDetection(): GgLoopDetectionDraft {
  const knobs = {} as Record<LoopDetectionSpec["key"], string>;
  for (const spec of LOOP_DETECTION_SPECS) knobs[spec.key] = "";
  return { enabled: false, knobs };
}

// The run's execution ceilings as the editor holds them: one *string* per ceiling,
// keyed by its wire field, so the form can hold "empty" (the ceiling is off, an error
// ceiling left to gg's default, or an unbounded turn ceiling) distinctly from `0`.
//
// A total record over `keyof GgRunLimits` rather than a hand-listed interface: a
// ceiling added to the contract is then a compile error in every function below.
export type GgRunLimitsDraft = Record<keyof GgRunLimits, string>;

// A whole gg configuration as the editor holds it, minus the test case/variant
// (those are per-run): the agent profiles, which of them is the root, the declared
// launch-time model slots, and the run's execution ceilings.
export interface GgConfigDraft {
  agents: GgAgentDraft[];
  // The [id](GgAgentDraft.id) of the agent that drives the run's top-level session.
  // A flag rather than a position or a name, so the root can be renamed freely and the
  // role moved to another profile without touching either. Serialization is what turns
  // it back into the wire format's "the root is `agents[0]`". Empty only while the
  // configuration has no agents at all — which is an editing state, not a savable one.
  rootAgentId: string;
  modelSlots: GgModelSlotDraft[];
  limits: GgRunLimitsDraft;
  // The run's own **session** hooks — the two events that fire once per run, before the
  // root's first turn and after its last. Run-level like the ceilings, because there is
  // no agent they could belong to: the run has not started when the first fires and has
  // finished when the second does.
  //
  // The other eight events belong to the agent whose write, command, compaction, start
  // or stop provoked them, and are held on that agent ([GgAgentDraft.hooks]).
  hooks: GgHookDraft[];
}

/**
 * One hook as the editor holds it: an id the list keys on, the event it fires at, which
 * of the three kinds it is, and a field per kind.
 *
 * Every kind's fields are held at once rather than in a discriminated union, so switching
 * a hook's kind and switching back does not lose what was typed — the same reason a
 * capability draft keeps the params of implementations it is not currently running.
 * [`capabilitySetFromDraft`] narrows it to the wire union on the way out.
 */
export interface GgHookDraft {
  id: string;
  event: GgHookEvent;
  kind: GgHookKind;
  /** An operator's label, shown wherever gg reports this hook running or blocking. */
  name: string;
  /** `command` only: the command line, its working directory, and its ceilings. */
  command: string;
  cwd: string;
  timeoutSecs: string;
  /** `command` only: an output-mode override, or empty to follow the agent's own. */
  output: string;
  /** `built-in` only: which of gg's own scripts to run. */
  script: string;
  /** `custom` only: the script's source. */
  source: string;
}

/** Which of the three shapes a [hook](GgHookDraft) is. */
export type GgHookKind = "command" | "built-in" | "custom";

/** The agent a draft flags as its root, or `undefined` when it has no agents. */
export function rootAgent(draft: GgConfigDraft): GgAgentDraft | undefined {
  return draft.agents.find((a) => a.id === draft.rootAgentId);
}

/**
 * The draft's agents in wire order — the root first, then the rest as the editor lists
 * them. gg reads the root off `agents[0]`, so this is where the editor's flag becomes
 * the contract's position.
 */
export function agentsInWireOrder(draft: GgConfigDraft): GgAgentDraft[] {
  const root = rootAgent(draft);
  if (!root) return [...draft.agents];
  return [root, ...draft.agents.filter((a) => a.id !== root.id)];
}

/**
 * Every ceiling left empty — the true "nothing set" state. This is the base the load
 * path fills stored values onto, so a stored configuration that declared no ceiling
 * round-trips to one that still declares none.
 */
export function blankRunLimits(): GgRunLimitsDraft {
  return {
    maxParallel: "",
    maxTurns: "",
    maxRuntimeSecs: "",
    maxConsecutiveErrors: "",
    maxErrorRate: "",
    errorRateWindow: "",
    maxCost: "",
    replayMaxBytes: "",
  };
}

/**
 * A fresh configuration's guardrails, with every one that has a documented default (the
 * parallelism cap and the two error ceilings) seeded to it, so a new configuration shows
 * gg's real default rather than an empty box. The turn ceiling is left empty (unbounded),
 * and runtime and cost are off.
 */
export function seededRunLimits(): GgRunLimitsDraft {
  const draft = blankRunLimits();
  for (const spec of RUN_LIMIT_SPECS) {
    if (spec.defaultValue !== undefined) draft[spec.key] = spec.defaultValue;
  }
  return draft;
}

/**
 * A capability's dedicated param controls seeded to their documented defaults.
 *
 * An `agent` param is skipped: its draft value is an agent's [local id](localId), and
 * its documented default ([ROOT_AGENT]) names the root — which only becomes an id once
 * a draft has a root to point at. [seedAgentParams] fills those in.
 */
function seededParams(cap: CapSpec): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of cap.params ?? []) {
    if (p.kind === "agent") continue;
    if (p.defaultValue !== undefined) out[p.key] = p.defaultValue;
  }
  return out;
}

/**
 * Point every unset `agent` param on `agent` at `rootAgentId`. The catalog spells those
 * defaults as [ROOT_AGENT] — "whichever profile is the root" — so they are seeded here,
 * where the draft's root is known, rather than by name.
 */
export function seedAgentParams(
  agent: GgAgentDraft,
  rootAgentId: string,
): GgAgentDraft {
  const capabilities = { ...agent.capabilities };
  for (const cap of CAPABILITIES) {
    const agentParams = (cap.params ?? []).filter(
      (p) => p.kind === "agent" && p.defaultValue === ROOT_AGENT,
    );
    if (!agentParams.length) continue;
    const draft = capabilities[cap.id] ?? blankCapabilityDraft();
    const params = { ...(draft.params ?? {}) };
    for (const p of agentParams) {
      if (!params[p.key]) params[p.key] = rootAgentId;
    }
    capabilities[cap.id] = { ...draft, params };
  }
  return { ...agent, capabilities };
}

/** A capability row that is off, unconfigured, and carries no params. */
export function blankCapabilityDraft(): GgCapabilityDraft {
  return { enabled: false, implementation: "", params: {}, extraParams: {} };
}

/**
 * A capability row as a *fresh* agent would carry it: the catalog's own on/off default,
 * with every param seeded to its documented default.
 *
 * This is what a capability the agent's [type](GgAgentMode) does not read is returned
 * to. An agent is saved with one type's configuration and no other, so reopening it and
 * switching type has to start from somewhere — and the only honest somewhere is what a
 * new agent of that type would have been, rather than whatever was on screen before the
 * type was changed.
 */
function defaultCapabilityDraft(cap: CapSpec): GgCapabilityDraft {
  return {
    enabled: Boolean(cap.defaultOn),
    implementation: "",
    params: seededParams(cap),
    extraParams: {},
  };
}

/**
 * The [type](GgAgentMode) a stored agent config records, read off the two mode-marker
 * capabilities. A config that names neither is a tool-calling agent, which is what every
 * configuration written before either existed was.
 *
 * A machine wins over responses-as-code when a (hand-written, or pre-type-selector)
 * config claims both: an FSM shell has no turns, so there is no reply for a program to
 * be, and the machine is unambiguously the thing that would run.
 */
function agentModeOf(
  capabilities: ReadonlyArray<GgCapabilityConfig>,
): GgAgentMode {
  const on = (id: string) =>
    capabilities.some((cap) => cap.id === id && cap.enabled);
  if (on(FSM_CAP_ID)) return "fsm";
  if (on(RESPONSES_AS_CODE_CAP_ID)) return "rac";
  return "tools";
}

/**
 * Whether a capability is live on this agent: its [type](GgAgentMode) reads it *and* it
 * is switched on. The two mode markers have no switch of their own — the type is their
 * switch — so for them the first half is the whole question.
 *
 * Everything that asks "does this agent have X?" has to ask it this way rather than
 * reading `capabilities[x].enabled`, which is only half the answer now: the draft
 * deliberately keeps what the agent's *other* types were configured with.
 */
export function capabilityActive(agent: GgAgentDraft, cap: CapSpec): boolean {
  if (!capabilityAppliesToMode(cap, agent.mode)) return false;
  return (
    isModeCapability(cap.id) || Boolean(agent.capabilities[cap.id]?.enabled)
  );
}

/**
 * `agent` with everything its [type](GgAgentMode) does not read returned to the catalog's
 * [defaults](defaultCapabilityDraft): every capability that belongs to another type, and —
 * for a machine, which is not a worker — the whole of a worker's configuration.
 *
 * This is the *commit* half of the type contract, and it is deliberately not applied
 * while the operator is editing: switching type and back inside one session must lose
 * nothing, but an agent that has been committed carries the configuration of the type it
 * was committed under and no other — which is exactly what gets saved, and so exactly
 * what has to come back.
 */
export function resetAgentForMode(agent: GgAgentDraft): GgAgentDraft {
  const capabilities = { ...agent.capabilities };
  for (const cap of CAPABILITIES) {
    if (capabilityAppliesToMode(cap, agent.mode)) continue;
    capabilities[cap.id] = defaultCapabilityDraft(cap);
  }
  // A machine takes no turns, so it has no model to run, no prompt to render, no roster
  // to spawn from and no lifecycle of its own to gate — it never writes a file, runs a
  // command, compacts, or ends a session anybody hooked. The form offers none of them
  // under this type; committing is where what an earlier type held stops being held.
  const worker = isFsmShell(agent)
    ? {
        modelSource: "model-slot" as const,
        modelSlotId: "",
        modelId: "",
        promptCacheTtl: "standard" as const,
        loopDetection: blankLoopDetection(),
        disabledTools: [],
        customInstructions: "",
        systemPromptTemplate: "",
        subagents: [],
        hooks: [],
      }
    : {};
  return { ...agent, ...worker, capabilities };
}

/** A freshly identified model-slot declaration with the given name and no default. */
export function blankModelSlot(name: string = ""): GgModelSlotDraft {
  return { id: localId("slot"), name, defaultModelId: "" };
}

/** The matching `primary` model-slot declaration, with no default. */
export function blankPrimaryModelSlot(): GgModelSlotDraft {
  return blankModelSlot(PRIMARY_SLOT);
}

// Build a full draft map with every catalog capability present, the given ids on,
// applying optional per-capability param defaults (used by the built-ins).
function draftsFor(
  enabledIds: ReadonlyArray<string>,
  paramDefaults: Record<string, Record<string, string>> = {},
): Record<string, GgCapabilityDraft> {
  const out: Record<string, GgCapabilityDraft> = {};
  for (const cap of CAPABILITIES) {
    out[cap.id] = {
      enabled: enabledIds.includes(cap.id),
      implementation: "",
      // Seed the catalog's documented defaults, then let a built-in's own overrides
      // win — so a fresh field shows gg's real default instead of an empty box.
      params: { ...seededParams(cap), ...(paramDefaults[cap.id] ?? {}) },
      extraParams: {},
    };
  }
  return out;
}

/**
 * A fresh agent profile deferring to the given model slot, with the given capabilities
 * on. The name defaults to [ROOT_AGENT] — the name a first profile is born with, not a
 * name anything checks for; pass another for an added agent. `modelSlotId` is empty when
 * the configuration declares no slot for it to defer to yet.
 *
 * The [type](GgAgentMode) is read off `enabledIds` the same way a stored config's is read
 * off its capability list, so a caller says "everything on" once and gets the agent that
 * describes — rather than having to say which type "everything" implies.
 */
export function blankAgentDraft(
  name: string = ROOT_AGENT,
  enabledIds: ReadonlyArray<string> = [],
  paramDefaults: Record<string, Record<string, string>> = {},
  modelSlotId: string = "",
): GgAgentDraft {
  return {
    id: localId("agent"),
    name,
    mode: agentModeOf(
      enabledIds.map((id) => ({ id, enabled: true, params: {} })),
    ),
    capabilities: draftsFor(enabledIds, paramDefaults),
    modelSource: "model-slot",
    modelSlotId,
    modelId: "",
    disabledTools: [],
    customInstructions: "",
    systemPromptTemplate: "",
    promptCacheTtl: "standard",
    loopDetection: blankLoopDetection(),
    subagents: [],
    hooks: [],
  };
}

/**
 * `agents` with every reference to the removed profile `removedId` cleared: roster
 * entries pointing at it are dropped, and any `agent` param naming it falls back to
 * `fallbackId` (the merge agent is *required*, so a dangling one would make the
 * configuration unsavable for a reason no control could show). Passing an empty
 * `fallbackId` — the last agent was removed — clears such a param instead.
 */
export function dropAgentReferences(
  agents: GgAgentDraft[],
  removedId: string,
  fallbackId: string,
): GgAgentDraft[] {
  return agents.map((agent) => {
    const capabilities = { ...agent.capabilities };
    for (const cap of CAPABILITIES) {
      const agentParams = (cap.params ?? []).filter((p) => p.kind === "agent");
      const capDraft = capabilities[cap.id];
      if (!agentParams.length || !capDraft?.params) continue;
      const params = { ...capDraft.params };
      for (const p of agentParams) {
        if (params[p.key] === removedId) params[p.key] = fallbackId;
      }
      capabilities[cap.id] = { ...capDraft, params };
    }
    return {
      ...agent,
      capabilities,
      subagents: agent.subagents.filter((s) => s.agentId !== removedId),
    };
  });
}

/** A default agent name no profile in `agents` has taken. */
export function unusedAgentName(agents: ReadonlyArray<GgAgentDraft>): string {
  const taken = new Set(agents.map((a) => a.name.trim()));
  let n = agents.length + 1;
  let name = `agent-${n}`;
  while (taken.has(name)) name = `agent-${++n}`;
  return name;
}

// --- The starting configuration --------------------------------------------------
//
// What a new configuration opens on. There is deliberately no catalogue of read-only
// built-ins beside it: a shared configuration nobody can edit is one every operator's
// first act is to duplicate, and the copies then drift from a "standard arm" that was
// never standard for anyone. Every configuration on the list is the operator's own.

// The capabilities that read the agent's **roster** — delegation, board dispatch and
// succession. A profile enabling any of them and listing nobody is at best inert (no
// `spawn_subagent`, no `exec`) and at worst unlaunchable: gg refuses an agent that may
// file issues with no implementer to assign them to. A single-agent configuration has
// exactly one profile it can name, which is itself — a shape the contract explicitly
// allows, and the only one under which "one agent, everything on" means anything.
const ROSTER_CAP_IDS = [
  "subagents",
  "project-management",
  "exec",
] as const;

/**
 * A whole draft around one agent: it is the root, it defers to a freshly declared
 * `primary` model slot, any `agent` param it carries points at it, and — if it enables
 * anything that needs a roster — it lists itself in every scope.
 */
function singleAgentDraft(agent: GgAgentDraft): GgConfigDraft {
  const slot = blankPrimaryModelSlot();
  const needsRoster = ROSTER_CAP_IDS.some(
    (id) => agent.capabilities[id]?.enabled,
  );
  const root = seedAgentParams(
    {
      ...agent,
      modelSource: "model-slot",
      modelSlotId: slot.id,
      subagents: needsRoster
        ? [
            {
              agentId: agent.id,
              description:
                "Itself — a single-agent configuration has one profile to delegate to, dispatch issues to and review with.",
              scopes: SUBAGENT_SCOPES.map((scope) => scope.value),
            },
          ]
        : agent.subagents,
    },
    agent.id,
  );
  return {
    agents: [root],
    rootAgentId: root.id,
    modelSlots: [slot],
    limits: seededRunLimits(),
    hooks: [],
  };
}

/** A deep copy of an agent draft. */
function cloneAgentDraft(agent: GgAgentDraft): GgAgentDraft {
  return {
    ...agent,
    capabilities: Object.fromEntries(
      Object.entries(agent.capabilities).map(([id, cap]) => [
        id,
        {
          ...cap,
          params: { ...(cap.params ?? {}) },
          extraParams: { ...(cap.extraParams ?? {}) },
        },
      ]),
    ),
    disabledTools: [...agent.disabledTools],
    subagents: agent.subagents.map((s) => ({ ...s })),
    hooks: agent.hooks.map((h) => ({ ...h })),
  };
}

/**
 * A deep copy of a draft, so duplicating a configuration never aliases the one it came
 * from. Local ids are copied as they are: a duplicate is the same configuration in a new
 * editing session, and the two are never live at once.
 */
export function cloneDraft(draft: GgConfigDraft): GgConfigDraft {
  return {
    agents: draft.agents.map(cloneAgentDraft),
    rootAgentId: draft.rootAgentId,
    modelSlots: draft.modelSlots.map((s) => ({ ...s })),
    limits: { ...draft.limits },
    hooks: draft.hooks.map((h) => ({ ...h })),
  };
}

/**
 * A blank draft: a single root agent with every catalog capability present and off,
 * one declared `primary` model slot, and the root deferred to it.
 */
export function emptyDraft(): GgConfigDraft {
  return singleAgentDraft(blankAgentDraft());
}

// --- `toggles` params -----------------------------------------------------------
//
// A `toggles` param is a JSON object of independently switchable members, each with its
// own default arm: almost all are **on** unless switched off, and one — response
// healing's `drop-doubled-response` — is **off** unless armed (see the catalog's
// `defaultOff`).
//
// The draft holds the ids of the members whose switch has been MOVED OFF ITS OWN DEFAULT,
// comma-separated, so it stays a plain string like every other dedicated control. Storing
// the deviations rather than a raw off-list is what lets the two arms coexist: an empty
// draft value means "every member at its default", whichever way each of those points,
// and only a moved member is ever written to the wire.

const TOGGLE_SEPARATOR = ",";

/** Whether a member is on when nothing has touched it. */
function toggleDefaultOn(option: { defaultOff?: boolean }): boolean {
  return !option.defaultOff;
}

/** The member ids a draft value marks as moved off their default, as a set. */
function togglesMoved(spec: ParamSpec, raw: string | undefined): Set<string> {
  const ids = new Set(
    (raw ?? "")
      .split(TOGGLE_SEPARATOR)
      .map((id) => id.trim())
      .filter(Boolean),
  );
  // Filtered against the catalog, so a stale id from an older client cannot make a
  // member that no longer exists decide anything.
  return new Set(
    (spec.options ?? []).map((o) => o.value).filter((id) => ids.has(id)),
  );
}

/**
 * The switched-**off** member ids a `toggles` draft value stands for, in catalog order —
 * what the form's checkboxes are drawn from. A member is off when it has been moved and
 * its default was on, or when it has NOT been moved and its default was off.
 */
export function togglesOff(
  spec: ParamSpec,
  raw: string | undefined,
): ReadonlyArray<string> {
  const moved = togglesMoved(spec, raw);
  return (spec.options ?? [])
    .filter((o) => moved.has(o.value) === toggleDefaultOn(o))
    .map((o) => o.value);
}

/** The draft value for a `toggles` param with exactly `off` switched off. */
export function togglesDraftValue(
  spec: ParamSpec,
  off: ReadonlyArray<string>,
): string {
  const offSet = new Set(off);
  return (spec.options ?? [])
    .filter((o) => offSet.has(o.value) === toggleDefaultOn(o))
    .map((o) => o.value)
    .join(TOGGLE_SEPARATOR);
}

/**
 * The draft value a *stored* `toggles` param decodes to, or `null` when the stored
 * value is not one this control can represent.
 *
 * The two scalar forms are gg's own shorthands, and they are not symmetric: `true` means
 * "the defaults" (which is not the same as "everything on" once a member defaults off),
 * while `false` is the master switch and means every member off.
 */
function togglesFromParam(spec: ParamSpec, value: unknown): string | null {
  const options = spec.options ?? [];
  const ids = options.map((o) => o.value);
  if (value === false) return togglesDraftValue(spec, ids);
  if (value === true) return "";
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (
    entries.some(([id, on]) => !ids.includes(id) || typeof on !== "boolean")
  ) {
    return null;
  }
  // A member the stored object does not mention takes its own default, so the off-list
  // has to be resolved over every member rather than read off the entries alone —
  // otherwise an unmentioned default-off member would come back armed.
  const stated = new Map(entries as Array<[string, boolean]>);
  return togglesDraftValue(
    spec,
    options
      .filter((o) => !(stated.get(o.value) ?? toggleDefaultOn(o)))
      .map((o) => o.value),
  );
}

/**
 * The JSON a `toggles` draft value writes, or `undefined` when every member sits at its
 * own default (which writes no param at all). Only the moved members are recorded — a
 * default-on member switched off as `false`, and a default-off member armed as `true`.
 */
function togglesToParam(
  spec: ParamSpec,
  raw: string,
): Record<string, boolean> | undefined {
  const off = new Set(togglesOff(spec, raw));
  const out: Record<string, boolean> = {};
  for (const option of spec.options ?? []) {
    const on = !off.has(option.value);
    if (on === toggleDefaultOn(option)) continue;
    out[option.value] = on;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// --- `states` params (the FSM machine) ------------------------------------------
//
// A `states` param is a whole finite-state machine: an ordered list of states, the
// first of which is the one the machine enters, each naming an agent profile to run and
// the edges out of it. It is held as the JSON *text* of the list, so the draft stays a
// flat `Record<string, string>` and a half-written state survives a re-render — but
// unlike every other param it carries cross-references, in both
// directions: a state names an agent profile (held as that profile's [local id](localId),
// so a rename follows it), and a transition names a sibling *state* (held as the state's
// name, because a state's identity in the machine IS its name — it is what the model
// passes to `transition_state`, and what gg's own validation resolves).
//
// Renaming a state therefore has to carry its inbound edges, which [renameStateDraft]
// does; nothing else in the editor may write a state's name.

/** One transition out of a state, as the editor holds it. */
export interface TransitionDraft {
  /** The name of the state this edge leads to; empty on a freshly added row. */
  to: string;
  /** The module kinds the successor inherits live. */
  transfer: GgModuleKind[];
  /** When the model should take this edge, in the author's words. */
  description: string;
}

/** One state of a machine, as the editor holds it. */
export interface StateDraft {
  name: string;
  /**
   * The [local id](localId) of the agent profile this state runs — or, between
   * [statesFromParam] and [resolveAgentReferences], the *name* a stored machine spelled.
   * Empty when the state names none, which is a save-blocking error.
   */
  agentId: string;
  transitions: TransitionDraft[];
}

/**
 * A blank state, appended by the editor's "+ Add state". Its name is left empty
 * deliberately: a machine's states are named for the work they do, and a pre-filled
 * `state 3` is a name an author leaves in place.
 */
export function blankStateDraft(): StateDraft {
  return { name: "", agentId: "", transitions: [] };
}

/**
 * A fresh transition to `to`, pre-filled with the one transfer that is almost always
 * wanted: the conversation. Explicit transfers are the contract (a recorded machine has
 * to say what it carries), and this is how the common case stays one click without a
 * default nobody wrote down — the checkbox is right there, ticked, in the record.
 */
export function blankTransitionDraft(to: string): TransitionDraft {
  return { to, transfer: ["history"], description: "" };
}

/** The kinds [MODULE_KINDS] declares, for filtering a stored transfer list. */
const MODULE_KIND_VALUES: ReadonlyArray<string> = MODULE_KINDS.map(
  (kind) => kind.value,
);

/**
 * The states a `states` draft value stands for. A value that is not the JSON list this
 * control writes yields no states rather than throwing — the draft is text a stored
 * configuration can put anything in, and a form that crashed on it would be worse than
 * one that shows an empty machine.
 */
export function statesFromDraft(
  raw: string | undefined,
): ReadonlyArray<StateDraft> {
  if (!raw?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map((entry) => {
    const state = entry as Partial<StateDraft>;
    return {
      name: String(state?.name ?? ""),
      agentId: String(state?.agentId ?? ""),
      transitions: Array.isArray(state?.transitions)
        ? state.transitions.map((edge) => ({
            to: String((edge as Partial<TransitionDraft>)?.to ?? ""),
            transfer: (Array.isArray(edge?.transfer)
              ? edge.transfer
              : []) as GgModuleKind[],
            description: String(
              (edge as Partial<TransitionDraft>)?.description ?? "",
            ),
          }))
        : [],
    };
  });
}

/** The draft value holding exactly `states` — the inverse of [statesFromDraft]. */
export function statesDraftValue(states: ReadonlyArray<StateDraft>): string {
  return states.length ? JSON.stringify(states) : "";
}

/**
 * `states` with the state at `index` renamed to `name`, carrying every edge that
 * pointed at its old name along with it.
 *
 * This is the one operation on a machine that is not a field edit: a transition
 * addresses a state by name, so a rename that did not follow its inbound edges would
 * turn a working machine into one gg refuses at launch — and would do it silently,
 * halfway through typing.
 */
export function renameStateDraft(
  states: ReadonlyArray<StateDraft>,
  index: number,
  name: string,
): StateDraft[] {
  const from = states[index]?.name ?? "";
  return states.map((state, i) => ({
    ...state,
    name: i === index ? name : state.name,
    // An edge pointing at the old name follows it. An empty old name (a state being
    // named for the first time) matches nothing, so a half-typed name never captures
    // the edges of the unnamed rows beside it.
    transitions: from
      ? state.transitions.map((edge) =>
          edge.to === from ? { ...edge, to: name } : edge,
        )
      : [...state.transitions],
  }));
}

/**
 * The draft value a *stored* `states` param decodes to, or `null` when the stored value
 * is not one this control can represent (which routes it to the verbatim passthrough,
 * so a hand-written machine carrying something the form has no field for is never
 * silently rewritten into a lesser one).
 *
 * The agent references land as **names** here; [resolveAgentReferences] maps them onto
 * local ids once every profile in the set has one.
 */
function statesFromParam(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const states: StateDraft[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return null;
    }
    const { name, agent, transitions, ...rest } = entry as Record<
      string,
      unknown
    >;
    if (Object.keys(rest).length) return null;
    if (typeof name !== "string") return null;
    if (agent !== undefined && typeof agent !== "string") return null;
    if (transitions !== undefined && !Array.isArray(transitions)) return null;
    const edges: TransitionDraft[] = [];
    for (const raw of transitions ?? []) {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        return null;
      }
      const { to, transfer, description, ...extra } = raw as Record<
        string,
        unknown
      >;
      if (Object.keys(extra).length) return null;
      if (typeof to !== "string") return null;
      if (description !== undefined && typeof description !== "string") {
        return null;
      }
      if (transfer !== undefined && !Array.isArray(transfer)) return null;
      // A transfer entry that is not a module kind is dropped rather than refused —
      // exactly as gg's own lenient deserializer drops it — so a machine written
      // against a newer (or mistyped) vocabulary still opens as the machine it is.
      const kinds = (transfer ?? []).filter(
        (kind): kind is GgModuleKind =>
          typeof kind === "string" && MODULE_KIND_VALUES.includes(kind),
      );
      edges.push({ to, transfer: kinds, description: description ?? "" });
    }
    states.push({ name, agentId: agent ?? "", transitions: edges });
  }
  return statesDraftValue(states);
}

/**
 * The JSON a `states` draft value writes, or `undefined` when it declares no state at
 * all (which writes no param — the arm gg refuses at launch, and which the editor
 * refuses to save, but which is a legitimate half-built state to hold).
 *
 * `agentName` turns each state's [local id](localId) back into the profile name the
 * contract carries; omit it (the validation path) to leave the ids as they are.
 */
function statesToParam(
  raw: string,
  agentName?: (agentId: string) => string,
): Array<Record<string, unknown>> | undefined {
  const states = statesFromDraft(raw);
  if (!states.length) return undefined;
  return states.map((state) => ({
    name: state.name.trim(),
    agent: agentName ? agentName(state.agentId) : state.agentId,
    transitions: state.transitions.map((edge) => ({
      to: edge.to.trim(),
      transfer: [...edge.transfer],
      ...(edge.description.trim()
        ? { description: edge.description.trim() }
        : {}),
    })),
  }));
}

/** Whether `agent`'s profile is an **FSM shell** — a machine rather than a worker. */
export function isFsmShell(agent: GgAgentDraft): boolean {
  return agent.mode === "fsm";
}

/** The machine `agent` declares, empty when it declares none. */
export function agentStates(agent: GgAgentDraft): ReadonlyArray<StateDraft> {
  return statesFromDraft(
    agent.capabilities[FSM_CAP_ID]?.params?.[FSM_STATES_PARAM],
  );
}

/**
 * Why `agent`'s machine could not be launched, or `null` when it is well-formed —
 * mirroring `fsm::validate` in `crates/gg/src/fsm.rs` exactly, so a configuration the
 * editor accepts is one gg will start. Every one of these is structural: a machine with
 * any of them is not a differently-configured run, it is an unrunnable one.
 *
 * `agents` is the whole configuration, because half of these questions are about the
 * profiles the machine names rather than about the machine itself.
 */
export function fsmStatesError(
  agent: GgAgentDraft,
  agents: ReadonlyArray<GgAgentDraft>,
): string | null {
  if (!isFsmShell(agent)) return null;
  const name = agent.name.trim() || "this";
  const states = agentStates(agent);
  if (!states.length) {
    return `The \`${name}\` agent is a state machine but declares no states — an FSM agent has no turns of its own, so there would be nothing to run.`;
  }
  const seen = new Set<string>();
  for (const state of states) {
    const stateName = state.name.trim();
    if (!stateName) {
      return `The \`${name}\` machine has a state with no name — a transition addresses a state by name, so every state needs one.`;
    }
    if (seen.has(stateName)) {
      return `The \`${name}\` machine declares the \`${stateName}\` state more than once — a transition to it would have no single answer.`;
    }
    seen.add(stateName);
  }
  for (const state of states) {
    const stateName = state.name.trim();
    const runs = agents.find((a) => a.id === state.agentId);
    if (!runs) {
      return `The \`${name}\` machine's \`${stateName}\` state runs no agent this configuration declares — pick the profile it should run.`;
    }
    if (isFsmShell(runs)) {
      return `The \`${name}\` machine's \`${stateName}\` state runs \`${runs.name.trim()}\`, which is itself a state machine — a machine cannot be a state of another machine. Name one of its states' agents instead.`;
    }
    for (const edge of state.transitions) {
      if (!seen.has(edge.to.trim())) {
        return `The \`${name}\` machine's \`${stateName}\` state may transition to \`${edge.to.trim() || "(nothing)"}\`, which is not a state it declares.`;
      }
    }
  }
  return null;
}

/**
 * The things worth saying about a well-formed machine without refusing to save it —
 * the console half of `fsm::launch_warnings`. A run with one of these still happens; it
 * just will not be quite the machine that was written down.
 */
export function fsmStatesWarnings(
  agent: GgAgentDraft,
  agents: ReadonlyArray<GgAgentDraft>,
): string[] {
  if (!isFsmShell(agent) || fsmStatesError(agent, agents)) return [];
  const warnings: string[] = [];
  const states = agentStates(agent);
  // There is deliberately no "this shell also enables X" warning any more: an agent's
  // [type](GgAgentMode) is now the thing that is chosen, a machine offers no capability
  // controls at all, and none is saved for one — so the state the warning existed to
  // report is no longer reachable.
  //
  // Reachability, walked from the entry state exactly as gg walks it.
  const reachable = new Set<string>();
  const queue = [states[0]!.name.trim()];
  while (queue.length) {
    const at = queue.shift()!;
    if (reachable.has(at)) continue;
    reachable.add(at);
    const state = states.find((s) => s.name.trim() === at);
    for (const edge of state?.transitions ?? []) queue.push(edge.to.trim());
  }
  for (const state of states) {
    if (!reachable.has(state.name.trim())) {
      warnings.push(
        `The \`${state.name.trim()}\` state is unreachable from \`${states[0]!.name.trim()}\` — it is kept, but nothing can enter it.`,
      );
    }
  }
  return warnings;
}

// --- Agent config <-> draft -----------------------------------------------------

/**
 * Fill an agent draft from a stored agent config, so every catalog capability has a
 * row even if the config omits it, which means off.
 *
 * The stored config's cross-references are still *names* at this point: `slotIdByName`
 * resolves the model-slot binding, and the roster and `agent` params are resolved in a
 * second pass ([resolveAgentReferences]) once every profile in the set has an id.
 */
function agentDraftFromConfig(
  agent: GgAgentConfig,
  slotIdByName: ReadonlyMap<string, string>,
): GgAgentDraft {
  const stored = new Map(
    (agent.capabilities ?? []).map((cap) => [cap.id, cap] as const),
  );
  const capabilities: Record<string, GgCapabilityDraft> = {};
  for (const cap of CAPABILITIES) {
    const from = stored.get(cap.id);
    if (!from) {
      capabilities[cap.id] = blankCapabilityDraft();
      continue;
    }
    // A stored param is JSON; the editor's dedicated controls hold text. Route each
    // param to its dedicated control when the catalog declares one, and keep the rest
    // in the (non-editable) `extraParams` passthrough so nothing is lost on a
    // round-trip.
    const dedicated = new Map((cap.params ?? []).map((p) => [p.key, p]));
    // A `model` param's deferred half is stored under its own key, which is not a
    // catalog param of its own — it is loaded here (as a local slot id, the way an
    // agent's binding is) rather than falling through to the passthrough.
    const slotKeys = new Set(
      (cap.params ?? []).flatMap((p) =>
        p.kind === "model" && p.slotKey ? [p.slotKey] : [],
      ),
    );
    const params: Record<string, string> = {};
    const extraParams: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(from.params ?? {})) {
      if (slotKeys.has(key)) {
        const name = String(value).trim();
        params[key] = slotIdByName.get(name) ?? "";
        continue;
      }
      const spec = dedicated.get(key);
      if (!spec) {
        extraParams[key] = value;
        continue;
      }
      if (spec.kind === "toggles") {
        const decoded = togglesFromParam(spec, value);
        if (decoded === null) extraParams[key] = value;
        else params[key] = decoded;
        continue;
      }
      if (spec.kind === "boolean") {
        // A stored `false` is the same as an absent key, so it loads as the empty
        // (off) draft value and re-saves as no key rather than an explicit `false`.
        if (typeof value !== "boolean") extraParams[key] = value;
        else params[key] = value ? "true" : "";
        continue;
      }
      if (spec.kind === "states") {
        const decoded = statesFromParam(value);
        if (decoded === null) extraParams[key] = value;
        else params[key] = decoded;
        continue;
      }
      params[key] = String(value);
    }
    capabilities[cap.id] = {
      enabled: from.enabled,
      implementation: from.implementation ?? "",
      params,
      extraParams,
    };
  }
  // The type first, then the capabilities its type does not read wound back to the
  // catalog's defaults: a stored agent carries one type's configuration and no other, so
  // there is nothing for the rest of them to be loaded *from*.
  return resetAgentForMode({
    id: localId("agent"),
    name: agent.name,
    mode: agentModeOf(agent.capabilities ?? []),
    capabilities,
    modelSource: agent.modelSlot ? "model-slot" : "model",
    modelSlotId: slotIdByName.get(agent.modelSlot?.trim() ?? "") ?? "",
    modelId: agent.modelId ?? "",
    disabledTools: [...(agent.disabledTools ?? [])],
    customInstructions: agent.customInstructions ?? "",
    systemPromptTemplate: agent.systemPromptTemplate ?? "",
    // A configuration stored before the lifetime was configurable names none, and reads
    // as the standard one — the same reading gg gives it.
    promptCacheTtl: agent.promptCacheTtl ?? "standard",
    loopDetection: loopDetectionDraft(agent.loopDetection),
    hooks: (agent.hooks ?? []).map((hook, index) =>
      hookDraft(hook, `${agent.name}-${index}`),
    ),
    // Filled in by [resolveAgentReferences], which needs every profile's id.
    subagents: [],
  });
}

/**
 * Resolve one agent's *name*-keyed cross-references — its roster and its `agent` params
 * — onto the local ids the draft works in.
 *
 * A roster entry naming a profile the set does not declare is dropped: gg refuses such a
 * set at launch, and the draft has no id to point it at, so carrying it would only be a
 * broken reference the editor could not show. An `agent` param that names no declared
 * profile *is* kept verbatim, because it round-trips as itself and the form flags it as
 * missing rather than silently repointing it. A [machine](StateDraft)'s state agents are
 * resolved the same way, for the same reason.
 */
function resolveAgentReferences(
  draft: GgAgentDraft,
  stored: GgAgentConfig,
  idByName: ReadonlyMap<string, string>,
): GgAgentDraft {
  const capabilities = { ...draft.capabilities };
  for (const cap of CAPABILITIES) {
    const agentParams = (cap.params ?? []).filter(
      (p) => p.kind === "agent" || p.kind === "states",
    );
    if (!agentParams.length) continue;
    const capDraft = capabilities[cap.id];
    if (!capDraft?.params) continue;
    const params = { ...capDraft.params };
    for (const p of agentParams) {
      if (p.kind === "states") {
        const states = statesFromDraft(params[p.key]);
        if (!states.length) continue;
        params[p.key] = statesDraftValue(
          states.map((state) => ({
            ...state,
            agentId: idByName.get(state.agentId) ?? state.agentId,
          })),
        );
        continue;
      }
      const name = params[p.key];
      if (name) params[p.key] = idByName.get(name) ?? name;
    }
    capabilities[cap.id] = { ...capDraft, params };
  }
  return {
    ...draft,
    capabilities,
    subagents: (stored.subagents ?? []).flatMap((s) => {
      const agentId = idByName.get(s.agent);
      if (!agentId) return [];
      return [
        {
          agentId,
          description: s.description ?? "",
          // A stored entry with no `scopes` predates them, and meant plain spawning.
          scopes: s.scopes?.length
            ? [...s.scopes]
            : (["subagent"] as GgSubagentScope[]),
        },
      ];
    }),
  };
}

/**
 * Fill a draft from a stored capability set. A set with no agents (which should never
 * happen — the backend migrates legacy sets to a root agent) is given a fresh one, so
 * the editor never opens on an empty agent list. Every model slot an agent defers to
 * is guaranteed present in the declared list, so a stored set with a dangling
 * reference still opens on a legible form. The wire format's root is `agents[0]`, which
 * is what the draft's root flag is set from.
 */
export function draftFromCapabilitySet(set: GgCapabilitySet): GgConfigDraft {
  const stored: ReadonlyArray<GgAgentConfig> =
    set.agents && set.agents.length > 0
      ? set.agents
      : [
          {
            name: ROOT_AGENT,
            capabilities: DEFAULT_CAP_IDS.map((id) => ({
              id,
              enabled: true,
              params: {},
            })),
            modelId: "",
          },
        ];
  const modelSlots: GgModelSlotDraft[] = (set.modelSlots ?? []).map((s) => ({
    id: localId("slot"),
    name: s.name,
    defaultModelId: s.defaultModelId ?? "",
  }));
  // An agent — or one of its [`model` params](MODEL_PARAMS) — may name a slot the set
  // never declared; declare it here so the binding has something real to point at rather
  // than opening as an unexplained blank.
  const declare = (name: string | undefined) => {
    const trimmed = name?.trim();
    if (trimmed && !modelSlots.some((m) => m.name === trimmed)) {
      modelSlots.push({
        id: localId("slot"),
        name: trimmed,
        defaultModelId: "",
      });
    }
  };
  for (const agent of stored) {
    declare(agent.modelSlot);
    for (const { capId, slotKey } of MODEL_PARAMS) {
      const capability = agent.capabilities?.find((c) => c.id === capId);
      const value = capability?.params?.[slotKey];
      if (typeof value === "string") declare(value);
    }
  }
  const slotIdByName = new Map(modelSlots.map((s) => [s.name, s.id] as const));
  const agents = stored.map((agent) =>
    agentDraftFromConfig(agent, slotIdByName),
  );
  const idByName = new Map(
    stored.map((agent, i) => [agent.name, agents[i]!.id] as const),
  );
  const rootAgentId = agents[0]!.id;
  return {
    agents: agents.map((agent, i) =>
      // [seedAgentParams] fills only the `agent` params that are *unset*, which after the
      // load is exactly the ones a capability the agent's type does not read was wound
      // back to its default. A stored value has already been resolved to a local id by
      // the pass before it and is left alone.
      seedAgentParams(
        resolveAgentReferences(agent, stored[i]!, idByName),
        rootAgentId,
      ),
    ),
    rootAgentId,
    modelSlots,
    limits: runLimitsDraft(set.limits),
    hooks: (set.hooks ?? []).map(hookDraft),
  };
}

/**
 * A stored hook as the editor holds it — every kind's fields present, with the ones this
 * hook's kind does not use left blank.
 */
function hookDraft(hook: GgHook, key: string | number): GgHookDraft {
  const action = hook.action;
  return {
    // Unique across the whole draft, not just within one list: an agent's hooks and the
    // run's are two lists in one form, and React would happily reuse a row between them.
    id: `hook-${key}`,
    event: hook.event,
    kind: action.type,
    name: hook.name ?? "",
    command: action.type === "command" ? action.command : "",
    cwd: action.type === "command" ? (action.cwd ?? "") : "",
    timeoutSecs:
      action.type === "command" && action.timeoutSecs !== undefined
        ? String(action.timeoutSecs)
        : "",
    output: action.type === "command" ? (action.output ?? "") : "",
    script: action.type === "built-in" ? action.script : "",
    source: action.type === "custom" ? action.source : "",
  };
}

/**
 * A fresh hook: a command on the event an operator reaches for most, within the scope it
 * is being added to.
 *
 * The scope decides the default event because the two lists offer disjoint events: a hook
 * added to an agent must open on one of that agent's, and one added to the run on one of
 * the run's. Opening on the wrong half would make every new hook start life invalid.
 */
export function blankHookDraft(scope: GgHookScope = "agent"): GgHookDraft {
  return {
    id: localId("hook"),
    event: scope === "session" ? "session-start" : "agent-stop",
    kind: "command",
    name: "",
    command: "",
    cwd: "",
    timeoutSecs: "",
    output: "",
    script: GG_BUILTIN_HOOK_IDS[0]!,
    source: "",
  };
}

/**
 * The wire form of the editor's hooks — the union narrowed to the kind each one is, with
 * every blank optional dropped.
 *
 * A hook with nothing to run is **dropped** rather than serialized: a `command` hook with
 * an empty command line and a `custom` one with no source are both editing states, and
 * writing them out would put a hook on the run that fires and does nothing.
 */
function hooksFromDraft(hooks: GgHookDraft[]): GgHook[] {
  return hooks.flatMap((hook): GgHook[] => {
    const name = hook.name.trim();
    const base = name ? { name } : {};
    if (hook.kind === "command") {
      const command = hook.command.trim();
      if (!command) return [];
      const cwd = hook.cwd.trim();
      const timeout = Number(hook.timeoutSecs.trim());
      const output = hook.output.trim();
      return [
        {
          ...base,
          event: hook.event,
          action: {
            type: "command" as const,
            command,
            ...(cwd ? { cwd } : {}),
            ...(hook.timeoutSecs.trim() && Number.isFinite(timeout)
              ? { timeoutSecs: timeout }
              : {}),
            ...(output ? { output } : {}),
          },
        },
      ];
    }
    if (hook.kind === "built-in") {
      const script = hook.script.trim();
      if (!script) return [];
      return [
        { ...base, event: hook.event, action: { type: "built-in" as const, script } },
      ];
    }
    const source = hook.source.trim();
    if (!source) return [];
    return [
      { ...base, event: hook.event, action: { type: "custom" as const, source } },
    ];
  });
}

/**
 * A stored ceiling set as the form's text fields. An absent ceiling stays the empty
 * string — the form's own spelling of "off".
 *
 * A [`mib`](RunLimitSpec.kind) ceiling is stored in bytes and edited in mebibytes, so it
 * is divided down here and multiplied back in [runLimitsFromDraft]. A stored value that
 * is not a whole number of MiB shows its fraction rather than being rounded to one the
 * operator did not write.
 */
function runLimitsDraft(limits: GgRunLimits | undefined): GgRunLimitsDraft {
  const draft = blankRunLimits();
  for (const spec of RUN_LIMIT_SPECS) {
    const value = limits?.[spec.key];
    if (value === undefined) continue;
    draft[spec.key] =
      spec.kind === "mib" ? String(value / BYTES_PER_MIB) : String(value);
  }
  return draft;
}

// The result of assembling a capability's params: the params object on success, or an
// error string the form surfaces inline when a dedicated control holds something its
// kind cannot accept.
type ParamsParse =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Validate + fold a capability's dedicated param controls over the params a stored
 * configuration carried that no control covers ([GgCapabilityDraft.extraParams]). A
 * dedicated control's value wins over a same-named passthrough key.
 *
 * `agentName` turns an `agent` param's draft value — a profile's [local id](localId) —
 * back into the name gg reads. Omit it to check the params without resolving anything
 * (the validation path), which leaves such a value as it is.
 */
export function capabilityParams(
  cap: CapSpec,
  draft: GgCapabilityDraft,
  agentName?: (agentId: string) => string,
  slotName?: (slotId: string) => string,
): ParamsParse {
  const out: Record<string, unknown> = { ...(draft.extraParams ?? {}) };
  for (const p of cap.params ?? []) {
    // A `model` param writes one of two keys, and the deferred one is held under
    // [ParamSpec.slotKey] rather than under the param's own key — so it is read before
    // the shared "an empty draft value writes nothing" guard below.
    if (p.kind === "model" && p.slotKey) {
      const slotId = (draft.params?.[p.slotKey] ?? "").trim();
      if (slotId) {
        out[p.slotKey] = slotName ? slotName(slotId) : slotId;
        continue;
      }
    }
    const raw = (draft.params?.[p.key] ?? "").trim();
    if (!raw) continue;
    if (p.kind === "agent") {
      out[p.key] = agentName ? agentName(raw) : raw;
      continue;
    }
    if (p.kind === "model") {
      out[p.key] = raw;
      continue;
    }
    if (p.kind === "select" || p.kind === "text") {
      out[p.key] = raw;
      continue;
    }
    if (p.kind === "toggles") {
      const toggles = togglesToParam(p, raw);
      if (toggles) out[p.key] = toggles;
      continue;
    }
    if (p.kind === "states") {
      const states = statesToParam(raw, agentName);
      if (states) out[p.key] = states;
      continue;
    }
    // A feature switch records only its *on* arm; off is the absent key (`raw` empty),
    // which the guard above already skipped.
    if (p.kind === "boolean") {
      if (raw === "true") out[p.key] = true;
      continue;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      return { ok: false, error: `${p.label} must be a number.` };
    }
    if (p.kind === "fraction" && (n < 0 || n > 1)) {
      return { ok: false, error: `${p.label} must be between 0 and 1.` };
    }
    out[p.key] = n;
  }
  return { ok: true, value: out };
}

// --- Tool-ablation bundles ------------------------------------------------------
//
// A capability's per-feature sliders (`CapSpec.toolAblation`) each stand for a whole
// bundle of tools that move together; the wire format stays per-tool
// (`disabledTools`), so these fold a bundle on/off across every tool it names.

/** Whether a tool bundle is available — none of its tools is withheld. */
export function toolBundleOn(
  disabledTools: ReadonlyArray<string>,
  tools: ReadonlyArray<string>,
): boolean {
  return !tools.some((t) => disabledTools.includes(t));
}

/** `disabledTools` with a whole bundle restored (`on`) or withheld (`!on`). */
export function setToolBundle(
  disabledTools: ReadonlyArray<string>,
  tools: ReadonlyArray<string>,
  on: boolean,
): string[] {
  const next = new Set(disabledTools);
  for (const tool of tools) {
    if (on) next.delete(tool);
    else next.add(tool);
  }
  return [...next];
}

// --- Run limits -----------------------------------------------------------------

/**
 * Why a draft's execution ceilings cannot be saved, or `null` when they are
 * well-formed.
 */
export function runLimitsError(limits: GgRunLimitsDraft): string | null {
  for (const spec of RUN_LIMIT_SPECS) {
    const raw = limits[spec.key].trim();
    if (!raw) continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) return `${spec.label} must be a number.`;
    if (spec.kind === "count" && (!Number.isInteger(value) || value < 0)) {
      return `${spec.label} must be a whole number of ${spec.key === "maxRuntimeSecs" ? "seconds" : "turns"}.`;
    }
    if (spec.kind === "fraction" && (value < 0 || value > 1)) {
      return `${spec.label} must be between 0 and 1.`;
    }
    if (spec.kind === "amount" && value <= 0) {
      return `${spec.label} must be greater than zero.`;
    }
    // A size is edited in MiB and stored in bytes, so a fraction is legitimate (a
    // stored ceiling that is not a whole MiB shows as one); only a negative size is
    // not a size.
    if (spec.kind === "mib" && value < 0) {
      return `${spec.label} cannot be negative.`;
    }
  }
  const rate = limits.maxErrorRate.trim();
  const window = limits.errorRateWindow.trim();
  if (Boolean(rate) !== Boolean(window)) {
    return "An error-rate ceiling needs both a rate and a window — either one alone is no ceiling at all.";
  }
  return null;
}

/**
 * The one thing about a well-formed ceiling set worth saying out loud without
 * refusing the save: a rate window that is not smaller than an explicit turn ceiling
 * can only ever fill on the last turn an agent is allowed. An unbounded turn ceiling
 * (the default — an empty field) has no last turn to pin the window to, so an explicit
 * window always has room to fill and nothing is said.
 */
export function runLimitsWarning(limits: GgRunLimitsDraft): string | null {
  const window = Number(limits.errorRateWindow.trim());
  if (!limits.errorRateWindow.trim() || !Number.isFinite(window)) return null;
  if (!limits.maxErrorRate.trim()) return null;
  if (!limits.maxTurns.trim()) return null;
  const turns = Number(limits.maxTurns.trim());
  if (!Number.isFinite(turns) || window < turns) return null;
  return `The error-rate window (${window}) isn't smaller than the turn ceiling (${turns}), so the rate ceiling could only ever fire on the last turn an agent is allowed.`;
}

/**
 * A draft's ceilings as the wire shape, or `undefined` when it declares none. A
 * [`mib`](RunLimitSpec.kind) ceiling is written back out as the byte count gg reads.
 */
export function runLimitsFromDraft(
  limits: GgRunLimitsDraft,
): GgRunLimits | undefined {
  const out: GgRunLimits = {};
  for (const spec of RUN_LIMIT_SPECS) {
    const raw = limits[spec.key].trim();
    if (!raw) continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    // Rounded, because bytes are what the wire carries and a fractional MiB would
    // otherwise write a fraction of a byte.
    out[spec.key] =
      spec.kind === "mib" ? Math.round(value * BYTES_PER_MIB) : value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// --- Loop detection ---------------------------------------------------------------
//
// A per-agent, non-capability lever (see [GgLoopDetectionDraft]). The two conversions
// below are the whole of its round-trip, and they are written to be exact in both
// directions: a stored declaration comes back knob for knob, and an agent that never
// touched the lever writes no key at all.

/**
 * A stored declaration as the editor holds it — every knob it named as text, every knob
 * it did not as an empty field. `undefined` (a configuration that predates the lever, or
 * one whose agent left it alone) is the disarmed default, which is exactly gg's own
 * reading of an absent key.
 */
export function loopDetectionDraft(
  stored: GgLoopDetection | undefined,
): GgLoopDetectionDraft {
  const draft = blankLoopDetection();
  if (!stored) return draft;
  draft.enabled = Boolean(stored.enabled);
  for (const spec of LOOP_DETECTION_SPECS) {
    const value = stored[spec.key];
    // `0` is a setting on two of these knobs, so the test is against `undefined` rather
    // than falsiness — `?? ""` would turn "abandon as soon as the window saturates" back
    // into "take gg's default of 3000".
    if (value !== undefined) draft.knobs[spec.key] = String(value);
  }
  return draft;
}

/**
 * The `loopDetection` key an agent writes, spread into its wire config — or nothing at
 * all when the agent is disarmed and named no knob, so a configuration that predates the
 * lever round-trips byte for byte.
 *
 * A knob is written only when its field holds a number: an empty field means "take gg's
 * default", which is the absent key, and half-typed text is not a value to record. A
 * DISARMED agent that nevertheless carries knobs still writes them — the operator tuned
 * the detector and switched it off, and silently discarding that on save would lose the
 * settings the next time it was armed.
 */
export function loopDetectionKey(draft: GgLoopDetectionDraft): {
  loopDetection?: GgLoopDetection;
} {
  const knobs: GgLoopDetection = { enabled: draft.enabled };
  let named = false;
  for (const spec of LOOP_DETECTION_SPECS) {
    const raw = draft.knobs[spec.key].trim();
    if (!raw) continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    knobs[spec.key] = value;
    named = true;
  }
  if (!draft.enabled && !named) return {};
  return { loopDetection: knobs };
}

/**
 * Why an agent's loop detection cannot be saved, or `null` when it is well-formed.
 *
 * Only checks what the *form* cannot express: a knob is a whole, non-negative count of
 * words, occurrences or characters. Everything gg itself merely warns about — a window of
 * zero, more offenders than the window can hold — is left to gg, which resolves such a
 * knob to its own default and says so at launch rather than refusing the run. Refusing the
 * save for those would be the console being stricter than the thing it configures.
 *
 * A disarmed agent is checked too: its knobs are still recorded, so a value that could
 * never be read back is still a value the operator will find later.
 */
export function loopDetectionError(draft: GgLoopDetectionDraft): string | null {
  for (const spec of LOOP_DETECTION_SPECS) {
    const raw = draft.knobs[spec.key].trim();
    if (!raw) continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) return `${spec.label} must be a number.`;
    if (!Number.isInteger(value) || value < 0) {
      return `${spec.label} must be a whole number, and cannot be negative.`;
    }
  }
  return null;
}

/**
 * The one thing about a well-formed, armed detector worth saying out loud without
 * refusing the save: asking for more distinct offenders than the window holds words is a
 * rule that can never be met, so the detector would run and never trip. gg warns about
 * exactly this at launch and arms the configuration as declared; saying it here is saying
 * it while it can still be fixed.
 *
 * Nothing is said for a disarmed agent — a warning about a value nothing will read is
 * noise — and nothing is said about a knob left empty, which takes gg's default.
 */
export function loopDetectionWarning(
  draft: GgLoopDetectionDraft,
): string | null {
  if (!draft.enabled) return null;
  const window = draft.knobs.windowWords.trim();
  const offenders = draft.knobs.minOffenders.trim();
  if (!window || !offenders) return null;
  const windowWords = Number(window);
  const minOffenders = Number(offenders);
  if (!Number.isFinite(windowWords) || !Number.isFinite(minOffenders)) {
    return null;
  }
  if (minOffenders <= windowWords) return null;
  return `The detector needs ${minOffenders} distinct repeated words in a window that only holds ${windowWords}, so it could never trip on repetition — only the reply ceiling would ever fire.`;
}

/**
 * One agent's per-capability param errors, keyed by capability id (`null` = ok).
 *
 * `agents` is the configuration this profile sits in, which the cross-field checks need:
 * a machine's states name *other* profiles, so whether they name anything real is a
 * question about the set rather than about the capability's own params. It defaults to
 * this agent alone, which is enough for every check that is purely local.
 */
export function agentParamErrors(
  agent: GgAgentDraft,
  agents: ReadonlyArray<GgAgentDraft> = [agent],
): Record<string, string | null> {
  const errors: Record<string, string | null> = {};
  for (const cap of CAPABILITIES) {
    // A capability the agent's [type](GgAgentMode) does not read is not offered, is not
    // saved, and so cannot be at fault — reporting its params would block a save on a
    // control that is not on the screen.
    if (!capabilityActive(agent, cap)) {
      errors[cap.id] = null;
      continue;
    }
    const parsed = capabilityParams(
      cap,
      agent.capabilities[cap.id] ?? blankCapabilityDraft(),
    );
    errors[cap.id] = parsed.ok ? null : parsed.error;
  }
  // The machine's own structure, checked the way gg checks it at launch — reported on
  // the capability that declares it, so it surfaces inline beside the state rows the
  // author has to fix rather than as a save-time surprise.
  errors[FSM_CAP_ID] = errors[FSM_CAP_ID] ?? fsmStatesError(agent, agents);
  return errors;
}

/**
 * Every `model` param in the catalog, with the capability it belongs to — the one place
 * that knows a capability param can name a model slot, so the load, save, launch and
 * bind paths all read the same list rather than each hardcoding "compaction's `model`".
 */
export const MODEL_PARAMS: ReadonlyArray<{
  capId: string;
  key: string;
  slotKey: string;
}> = CAPABILITIES.flatMap((cap) =>
  (cap.params ?? []).flatMap((p) =>
    p.kind === "model" && p.slotKey
      ? [{ capId: cap.id, key: p.key, slotKey: p.slotKey }]
      : [],
  ),
);

/**
 * The [ids](GgModelSlotDraft.id) of the model slots something in the configuration
 * actually defers to — an agent's own binding, or a [`model` param](MODEL_PARAMS). A
 * declared-but-unreferenced slot feeds nothing, so it is never asked about at launch (and
 * the editor flags it).
 */
export function referencedModelSlots(draft: GgConfigDraft): Set<string> {
  const out = new Set(
    draft.agents
      // A machine binds no model at all, so a slot it was pointed at under an earlier type
      // feeds nothing and must not become a launch input.
      .filter((a) => !isFsmShell(a) && a.modelSource === "model-slot")
      .map((a) => a.modelSlotId)
      .filter(Boolean),
  );
  for (const agent of draft.agents) {
    for (const { capId, slotKey } of MODEL_PARAMS) {
      // A slot named by a capability the agent's [type](GgAgentMode) does not read is
      // named by nothing that will be saved, so it feeds no launch input either.
      const cap = capabilitySpec(capId);
      if (!cap || !capabilityAppliesToMode(cap, agent.mode)) continue;
      const slotId = agent.capabilities[capId]?.params?.[slotKey];
      if (slotId) out.add(slotId);
    }
  }
  return out;
}

/**
 * The gg capability id and tool name behind the "an issue filer needs someone to
 * assign to" rule below. Spelled once so the rule and the catalog cannot drift.
 */
const PROJECT_MANAGEMENT_CAP_ID = "project-management";
const CREATE_ISSUE_TOOL = "create_issue";

/**
 * Whether `agent` can file board issues: the project-management capability is on and
 * its issue-creation feature has not been switched off.
 */
function filesIssues(agent: GgAgentDraft): boolean {
  const board = capabilitySpec(PROJECT_MANAGEMENT_CAP_ID);
  return (
    Boolean(board && capabilityActive(agent, board)) &&
    !agent.disabledTools.includes(CREATE_ISSUE_TOOL)
  );
}

/**
 * Why one agent profile cannot be saved on its own, or `null` when it is well-formed.
 *
 * This is deliberately narrower than [draftSaveError]: it asks only what is wrong with
 * *this* profile as the operator edits it, so the per-agent view never reports a fault
 * belonging to the configuration around it (an undeclared model slot, another agent's
 * bad params) as though it were this agent's.
 */
export function agentSaveError(
  draft: GgConfigDraft,
  agentId: string,
): string | null {
  const agent = draft.agents.find((a) => a.id === agentId);
  if (!agent) return null;
  const name = agent.name.trim();
  if (!name) return "This agent needs a name.";
  if (draft.agents.some((a) => a.id !== agent.id && a.name.trim() === name)) {
    return `Another agent is already called \`${name}\` — agent names must be unique.`;
  }
  // A machine takes no turns, so it runs no model and has no replies to watch: its
  // loop-detection draft is reset on commit and shown by no control, and reporting a
  // fault in a value nothing can see or read would be unfixable.
  if (!isFsmShell(agent)) {
    const loop = loopDetectionError(agent.loopDetection);
    if (loop) return loop;
  }
  const failed = Object.entries(agentParamErrors(agent, draft.agents)).find(
    ([, error]) => error !== null,
  );
  return failed ? failed[1] : null;
}

/**
 * Why a draft cannot be saved, or `null` when it is well-formed. A *saved*
 * configuration may still be waiting on its models — that is what a model slot is for
 * — so this rejects only an agent-less configuration, structurally broken names, a
 * *worker* deferred to a model slot that was never declared, a pinned worker with no
 * model, an issue filer with nobody to assign issues to, and unparseable params.
 *
 * A roster reference cannot dangle here — the draft holds it as a local id, and removing
 * an agent takes its references with it — so there is nothing to check for.
 */
export function draftSaveError(draft: GgConfigDraft): string | null {
  // Emptying the agent list is a legitimate editing state (it is how every profile gets
  // replaced); saving one is not, because a run has to have something to start.
  if (draft.agents.length === 0)
    return "A configuration needs at least one agent.";
  if (!rootAgent(draft)) return "One agent must be the root agent.";
  const agentNames = draft.agents.map((a) => a.name.trim());
  if (agentNames.some((n) => !n)) return "Every agent needs a name.";
  if (new Set(agentNames).size !== agentNames.length)
    return "Agent names must be unique.";

  const modelSlotNames = draft.modelSlots.map((s) => s.name.trim());
  if (modelSlotNames.some((n) => !n)) return "Every model slot needs a name.";
  if (new Set(modelSlotNames).size !== modelSlotNames.length)
    return "Model slot names must be unique.";

  for (const agent of draft.agents) {
    // A machine is asked for no model: it takes no turns, so there is nothing for one to
    // do, and the profiles its states run are checked as the workers they are, on their
    // own passes through this loop.
    if (!isFsmShell(agent)) {
      if (agent.modelSource === "model-slot") {
        const slot = draft.modelSlots.find((s) => s.id === agent.modelSlotId);
        if (!slot) {
          return `The \`${agent.name.trim()}\` agent defers to a model slot this configuration doesn't declare — pick one of its slots, or pin the agent a model.`;
        }
      } else if (!agent.modelId.trim()) {
        return `The \`${agent.name.trim()}\` agent pins no model — choose one, or bind it to a model slot.`;
      }
      const loop = loopDetectionError(agent.loopDetection);
      if (loop) {
        return `${loop.replace(/\.$/, "")} on the \`${agent.name.trim()}\` agent.`;
      }
    }
    // An issue names the agent it is dispatched to, drawn from the filer's own
    // *implementers* — so an agent that may file issues but lists none could never
    // write a valid one. gg refuses such a set at launch; refuse it here, where it can
    // still be fixed.
    if (
      filesIssues(agent) &&
      !agent.subagents.some((s) => s.scopes.includes("implementer"))
    ) {
      return `The \`${agent.name.trim()}\` agent can create issues but its roster lists no implementer to assign them to. Give one of its agents the Implementer scope, or switch its Issue creation feature off for read-only board access.`;
    }
    // A machine's structural faults are reported in their own words: they already name
    // the agent, the state and what is wrong with it, and "fix the fsm params" would
    // throw all of that away at exactly the moment it is needed.
    const machine = fsmStatesError(agent, draft.agents);
    if (machine) return machine;
    const failed = Object.entries(agentParamErrors(agent, draft.agents)).find(
      ([, error]) => error !== null,
    );
    if (failed) {
      return `Fix the ${failed[0]} params on the \`${agent.name.trim()}\` agent before saving.`;
    }
  }

  return runLimitsError(draft.limits);
}

// --- Draft -> capability set ----------------------------------------------------

/**
 * Serialize one agent draft into the wire [`GgAgentConfig`], resolving every local id it
 * refers to back into the name the contract carries: `agentName` for the roster and the
 * `agent` params, `slotName` for the model binding. An id neither resolves is written
 * through verbatim — it is a stored value the editor could not match to a declaration,
 * and dropping it would lose more than it fixed.
 */
function agentConfigFromDraft(
  agent: GgAgentDraft,
  agentName: (agentId: string) => string,
  slotName: (slotId: string) => string,
): GgAgentConfig {
  const capabilities: GgCapabilityConfig[] = CAPABILITIES.map((cap) => {
    // Only the selected [type](GgAgentMode)'s configuration is recorded. What the draft
    // still holds for the other types is a convenience of the editing session — switching
    // type and back must not lose an edit — and writing it down would be a claim about
    // the run that is not true: gg never reads it.
    if (!capabilityAppliesToMode(cap, agent.mode)) {
      return { id: cap.id, enabled: false, params: {} };
    }
    const capDraft = agent.capabilities[cap.id] ?? blankCapabilityDraft();
    const parsed = capabilityParams(cap, capDraft, agentName, slotName);
    const impl = (capDraft.implementation ?? "").trim();
    return {
      id: cap.id,
      // A mode marker has no switch of its own: reaching here at all means the agent's
      // type *is* this one, which is what the flag records.
      enabled: isModeCapability(cap.id) || Boolean(capDraft.enabled),
      ...(impl ? { implementation: impl } : {}),
      // Record the config even for a disabled capability, so an ablation's on/off arms
      // stay symmetric.
      params: parsed.ok ? parsed.value : {},
    };
  });
  // A machine is not a worker: it takes no turns, so it runs no model, renders no prompt
  // and spawns from no roster — each state runs the profile it names, with that profile's
  // configuration. None of that is written, for the same reason another type's
  // capabilities are not: a recorded run must not claim a binding gg never read. The
  // empty `modelId` is the contract's own spelling of "no model bound".
  if (isFsmShell(agent)) {
    return { name: agent.name.trim(), capabilities, modelId: "" };
  }
  const subagents: GgSubagentRef[] = agent.subagents
    .filter((s) => agentName(s.agentId) && s.scopes.length)
    .map((s) => ({
      agent: agentName(s.agentId),
      description: s.description,
      scopes: [...s.scopes],
    }));
  const custom = agent.customInstructions.trim();
  const template = agent.systemPromptTemplate;
  // Only this agent's own events. A session hook cannot reach here — the editor offers an
  // agent only the eight agent events — but the filter is the contract's own rule rather
  // than a trust in the form, and gg refuses a set that breaks it.
  const agentHooks = hooksFromDraft(
    agent.hooks.filter((hook) => hookScopeOf(hook.event) === "agent"),
  );
  return {
    name: agent.name.trim(),
    capabilities,
    modelId: agent.modelSource === "model" ? agent.modelId.trim() : "",
    ...(agent.modelSource === "model-slot"
      ? { modelSlot: slotName(agent.modelSlotId) }
      : {}),
    ...(agent.disabledTools.length
      ? { disabledTools: agent.disabledTools }
      : {}),
    ...(custom ? { customInstructions: custom } : {}),
    ...(template.trim() ? { systemPromptTemplate: template } : {}),
    // The standard lifetime is the default, so an agent left on it writes no key — which is
    // what keeps a configuration that predates the knob byte-identical after a round-trip.
    ...(agent.promptCacheTtl !== "standard"
      ? { promptCacheTtl: agent.promptCacheTtl }
      : {}),
    ...loopDetectionKey(agent.loopDetection),
    ...(subagents.length ? { subagents } : {}),
    ...(agentHooks.length ? { hooks: agentHooks } : {}),
  };
}

/**
 * Serialize a draft into the wire capability set. `preset` records the name the set
 * was assembled from (a run's slice-by facet); pass `null` for a hand-assembled one.
 * Only the model slots at least one agent defers to are saved, and the agents are
 * written root-first — which is how the draft's root *flag* becomes the contract's
 * "the root is `agents[0]`".
 */
export function capabilitySetFromDraft(
  draft: GgConfigDraft,
  preset: string | null,
): GgCapabilitySet {
  const referenced = referencedModelSlots(draft);
  const modelSlots: GgModelSlot[] = draft.modelSlots
    .filter((s) => referenced.has(s.id))
    .map((s) => ({
      name: s.name.trim(),
      ...(s.defaultModelId.trim()
        ? { defaultModelId: s.defaultModelId.trim() }
        : {}),
    }));
  const nameById = new Map(
    draft.agents.map((a) => [a.id, a.name.trim()] as const),
  );
  const slotNameById = new Map(
    draft.modelSlots.map((s) => [s.id, s.name.trim()] as const),
  );
  const agentName = (agentId: string) => nameById.get(agentId) ?? agentId;
  const slotName = (slotId: string) => slotNameById.get(slotId) ?? slotId;
  const limits = runLimitsFromDraft(draft.limits);
  // The run's half only — the two session events. Symmetric with the filter in
  // [agentConfigFromDraft]: between them, every hook lands in exactly one of the two
  // lists, whichever list the editor happened to hold it in.
  const hooks = hooksFromDraft(
    draft.hooks.filter((hook) => hookScopeOf(hook.event) === "session"),
  );
  return {
    ...(preset ? { preset } : {}),
    agents: agentsInWireOrder(draft).map((agent) =>
      agentConfigFromDraft(agent, agentName, slotName),
    ),
    ...(modelSlots.length ? { modelSlots } : {}),
    ...(limits ? { limits } : {}),
    ...(hooks.length ? { hooks } : {}),
  };
}

/**
 * The model-slot names a stored set defers to: each agent's own binding, plus every
 * [`model` param](MODEL_PARAMS) that named a slot instead of pinning a model.
 */
function deferredSlotNames(set: GgCapabilitySet): Set<string> {
  const out = new Set<string>();
  for (const agent of set.agents ?? []) {
    const own = agent.modelSlot?.trim();
    if (own) out.add(own);
    for (const { capId, slotKey } of MODEL_PARAMS) {
      const value = agent.capabilities?.find((c) => c.id === capId)?.params?.[
        slotKey
      ];
      const name = typeof value === "string" ? value.trim() : "";
      if (name) out.add(name);
    }
  }
  return out;
}

/**
 * The launch inputs a configuration is still waiting on: the model slots it declares
 * that something in it defers to, in declaration order.
 *
 * This is what the New run page asks for, and it is deliberately *only* this — an
 * agent the configuration pinned to a model outright was decided when the
 * configuration was written and is never asked about again.
 */
export function launchModelSlots(set: GgCapabilitySet): GgModelSlot[] {
  const declared = set.modelSlots ?? [];
  const deferred = deferredSlotNames(set);
  const out: GgModelSlot[] = [];
  const push = (slot: GgModelSlot) => {
    if (!out.some((s) => s.name === slot.name)) out.push(slot);
  };
  for (const declaration of declared) {
    if (deferred.has(declaration.name)) push(declaration);
  }
  // A binding that names a slot the set never declared still needs a model at launch.
  for (const name of deferred) {
    push({ name });
  }
  return out;
}

/**
 * The capability set to launch a run with: every [deferred](launchModelSlots) binding —
 * an agent's own, and every [`model` param](MODEL_PARAMS)'s — resolved to the model the
 * launcher collected for its slot (keyed by model-slot name), and the declarations
 * dropped. What runs is a fully pinned set.
 *
 * A binding the configuration pinned itself is untouched.
 */
export function bindModelSlots(
  set: GgCapabilitySet,
  models: Record<string, string>,
): GgCapabilitySet {
  const agents: GgAgentConfig[] = (set.agents ?? []).map((agent) => {
    const capabilities = (agent.capabilities ?? []).map((capability) => {
      const specs = MODEL_PARAMS.filter((m) => m.capId === capability.id);
      if (!specs.length) return capability;
      const params = { ...(capability.params ?? {}) };
      let bound = false;
      for (const { key, slotKey } of specs) {
        const slot = params[slotKey];
        if (typeof slot !== "string" || !slot.trim()) continue;
        const model = (models[slot.trim()] ?? "").trim();
        delete params[slotKey];
        // An empty binding pins nothing: the param goes back to being unset, which is
        // the arm gg already documents (condense on the agent's own model) rather than
        // a model id of "".
        if (model) params[key] = model;
        else delete params[key];
        bound = true;
      }
      return bound ? { ...capability, params } : capability;
    });
    const next = agent.capabilities ? { ...agent, capabilities } : agent;
    if (!next.modelSlot) return next;
    const { modelSlot: _slot, ...rest } = next;
    return { ...rest, modelId: (models[next.modelSlot] ?? "").trim() };
  });
  const { modelSlots: _declarations, ...rest } = set;
  return { ...rest, agents };
}
