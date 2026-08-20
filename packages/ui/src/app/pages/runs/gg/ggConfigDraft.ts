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
// Nothing in the draft refers to an agent profile by the name shown in the form. A roster
// entry, a machine's state, a capability's `agent` param and the root flag all hold the
// profile's **id** ([GgAgentDraft.id]) — the same id the wire format carries, the run's
// telemetry keys on, and the model itself passes back — so renaming a profile is free and
// two profiles may share a name without either reference becoming ambiguous.
//
// A **model slot** is the one thing still name-keyed on the wire (a launch input is labelled
// by slot name), so the draft gives each one a [local id](localId) and resolves it to a name
// on the way out and back to an id on the way in. That is what makes renaming a slot carry
// its bindings along instead of orphaning the ones that spelled the old name; those ids are
// editor-only and per-session, and nothing persists them.

import type {
  GgAgentConfig,
  GgCapabilityConfig,
  GgCapabilitySet,
  GgConfigSlot,
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
  AUTHORED_HOOK_TIMEOUT_SECS,
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
  ROOT_PROFILE_ID,
  RUN_LIMIT_SPECS,
  SUBAGENT_SCOPES,
  authoredImplementation,
  capabilityAppliesToMode,
  capabilitySpec,
  requiresImplementation,
  hookScopeOf,
  isModeCapability,
  type CapSpec,
  type GgAgentMode,
  type LoopDetectionSpec,
  type ParamSpec,
} from "./ggCatalog";

// One capability's draft state. `enabled` toggles the capability on/off;
// `implementation` is the selected arm (the A/B lever); and `params` holds the values of
// the capability's dedicated param controls keyed by param name, in string form.
//
// An empty `implementation` or an empty param is a hole rather than a default: gg
// substitutes nothing, so an enabled capability short of either is a save this module
// refuses ([agentParamErrors]). The only empty that means something is autoload
// specifications' unlocked arm, which gg spells as the absent key
// ([requiresImplementation]).
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

// A fresh local id. Local ids exist only inside an editing session: they give a model slot
// an identity independent of the name the wire carries, so a rename cannot orphan the
// bindings to it, and they key the form's hook rows. Nothing serializes them, so a plain
// monotonic counter is identity enough — two drafts alive at once never share one.
//
// An agent profile has no need of one: its [id](GgAgentDraft.id) is real, stored and shown.
let localIdCounter = 0;
export function localId(prefix: string): string {
  localIdCounter += 1;
  return `${prefix}-${localIdCounter}`;
}

/**
 * A fresh **internal id** for a profile: opaque, and unique for good.
 *
 * Opaque because nothing may read meaning into it — it is not shown, not passed to the
 * model, and not what a run names a profile by. Unique for good rather than unique within
 * the draft in hand, because it is written into the stored configuration and a profile
 * added after a reload must not land on one an earlier session minted.
 */
export function mintAgentKey(): string {
  const random = globalThis.crypto?.randomUUID?.();
  return random
    ? `a-${random.replace(/-/g, "").slice(0, 12)}`
    : `a-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

/**
 * The [slug](GgAgentDraft.slug) a name seeds: the name kebab-cased, with `-2`, `-3` …
 * appended until it is one no profile in `existing` already carries.
 *
 * A seed and nothing more. The slug is the operator's to write — it is what the model reads
 * in a roster and copies back into `spawn_subagent` — and this exists so a profile is born
 * with something legible to edit rather than an empty box. A name that slugs to nothing
 * (punctuation, a script with no ASCII) falls back to `agent`.
 */
export function mintAgentSlug(
  name: string,
  existing: ReadonlyArray<GgAgentDraft> = [],
): string {
  const slug =
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "agent";
  const taken = new Set(existing.map((a) => a.slug));
  if (!taken.has(slug)) return slug;
  let n = 2;
  while (taken.has(`${slug}-${n}`)) n += 1;
  return `${slug}-${n}`;
}

// One declared **model slot** as the editor holds it: a launch-time model parameter
// with an optional default the new-run form pre-fills. Declaring these is what makes
// one saved configuration reusable across models — the operator supplies the models
// at launch instead of the configuration baking them in.
export interface GgModelSlotDraft {
  // Editor-only identity: what a binding points at, so renaming a slot carries every
  // binding along instead of orphaning them. Never serialized — the wire format names
  // slots.
  id: string;
  name: string;
  defaultModelId: string;
  // Whether the launch form exposes this slot on its own, under `<agent slug>.<name>`,
  // rather than through a [configuration slot](GgConfigSlotDraft) that names it. A slot
  // reaches the launch form one way or the other, and never both.
  passthrough: boolean;
}

// One [agent slot](GgModelSlotDraft) a [configuration slot](GgConfigSlotDraft) fills.
export interface GgSlotTargetDraft {
  // The target profile's internal [id](GgAgentDraft.id), so the mapping survives a rename
  // of either end and stays unambiguous while two profiles carry one slug.
  agentId: string;
  // The target slot's editor-only [id](GgModelSlotDraft.id) on that profile.
  slotId: string;
}

// One **launch input** the configuration declares, and the agent slots it fills. A run
// asks for exactly one set of models, and this — with the configuration's passthrough
// agent slots — is that set.
export interface GgConfigSlotDraft {
  // Editor-only identity, so renaming the slot carries nothing along to fix.
  id: string;
  name: string;
  defaultModelId: string;
  targets: GgSlotTargetDraft[];
}

// Where an agent gets its model: from a declared model slot (supplied at launch) or
// pinned here, in the configuration, for every run of it.
export type GgAgentModelSource = "model-slot" | "model";

// One entry in an agent's delegation allowlist as the editor holds it: a target agent
// this agent may spawn (may be itself), plus the caller-scoped description that tells
// the spawning agent when to use it.
export interface GgSubagentDraft {
  // The target profile's [id](GgAgentDraft.id) — the same id the wire entry carries, so
  // renaming the target (or giving two profiles one name) leaves this pointed at it.
  agentId: string;
  description: string;
  // What this agent may use the target **for**. An entry with no scopes is dropped on
  // serialize — the editor removes a roster row by clearing its last scope rather than
  // by a separate delete, so "listed but usable for nothing" is never a state to save.
  scopes: GgSubagentScope[];
}

/**
 * Where an imported agent profile came from: the [saved agent](GgSavedAgent) it follows,
 * and that agent as it stands right now.
 *
 * An agent carrying one of these is a *reference*, not a copy. Every field the
 * configuration has not edited is taken from `base` each time the configuration is
 * read, so editing the saved agent reshapes this profile; the fields it has edited are
 * pinned here and leave the saved agent untouched. Which fields those are is derived by
 * comparing this profile against `base` rather than tracked as the operator types, so it
 * says the same thing after a reload as it does mid-edit.
 */
export interface GgAgentSourceDraft {
  /** The saved agent's opaque id — what the stored configuration points at. */
  agentId: string;
  /** Its name in the library, which is the name it was imported under. */
  name: string;
  /**
   * The saved agent's profile as it stands now: the basis every unedited field is taken
   * from. `null` when the saved agent is no longer on the account, which leaves this
   * profile as the ordinary inline agent the configuration already holds.
   */
  base: GgAgentConfig | null;
}

// One **agent profile** as the editor holds it: its name, its per-capability drafts
// (keyed by capability id), its single model binding (deferred to a declared model
// slot, or pinned here), its two call allowlists, its custom prompt bits, and the
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
  // The profile's **internal id**: what every reference in the draft points at — a roster
  // entry, an `agent` param, a machine's state, the configuration's root flag
  // ([GgConfigDraft.rootAgentId]), a configuration slot's target, and the link to the saved
  // agent this profile follows.
  //
  // [Minted](mintAgentKey) once, opaque, and never rewritten. Nothing reads meaning into
  // it and nobody is shown it, which is exactly what makes renaming a profile free and a
  // slug two profiles happen to share a thing an operator can still tell apart.
  id: string;
  // The profile's **slug**: the name the model is shown and passes back, written by the
  // operator and unique within the configuration ([isValidAgentSlug] is the shape).
  //
  // Also what a run names this profile by afterwards — its telemetry, its record and the
  // query language — because a launch rewrites every reference to it.
  slug: string;
  name: string;
  // The [model slots](GgModelSlotDraft) this agent's own bindings defer to. They belong
  // to the agent, so a profile imported from the library brings the slots its bindings
  // name and the configuration decides how each one reaches the launch form.
  modelSlots: GgModelSlotDraft[];
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
  // The two call allowlists, in the two independent vocabularies gg's surfaces are
  // written in: gg tool names, and gg operation ids. **Each list is the grant** — a
  // capability being on says which calls exist to be handed over, and these say which of
  // them this agent gets, with absent meaning none.
  //
  // The draft holds *both* even though an agent reads exactly one, for the reason it
  // holds every type's capability drafts: switching type and back inside one editing
  // session must lose nothing, and only one of these can be re-derived from the other —
  // neither, in fact, since the two vocabularies are not in bijection. So every editor
  // operation that grants or revokes (a capability toggle, a feature slider) writes both
  // halves, which keeps them agreeing about *which feature* is granted while saying it in
  // two languages, and [agentConfigFromDraft] records only the half this agent's type
  // reads.
  tools: string[];
  operations: string[];
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
  // The [saved agent](GgAgentSourceDraft) this profile follows, or `null` for one
  // declared inline. Detaching an imported profile clears it, which keeps the profile
  // exactly as it is and stops it following anything.
  source: GgAgentSourceDraft | null;
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
 * Loop detection as an agent that has never touched it holds it: off, with every knob
 * empty. This is also what a stored configuration that declares none loads as, and what
 * such an agent saves back as — no key at all. A disarmed detector owes no knobs, which is
 * why the empty fields are legitimate here and are not once it is [armed](armLoopDetection).
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
  // The **launch inputs** this configuration declares, each naming the agent slots it
  // fills. Not the whole of what a launch asks for: a passthrough agent slot is exposed
  // on its own. [launchModelSlots] is the one set of inputs a run is launched with.
  modelSlots: GgConfigSlotDraft[];
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
 * A fresh configuration's guardrails: the two [required](RunLimitSpec.required) ceilings
 * written to their authored figures, and every other field empty — which is that ceiling
 * unarmed, and the only thing an empty field here means.
 *
 * A run always has an agent pool and always writes a capture journal, so those two are
 * always in the document. The turn, runtime, cost and error ceilings are each a guardrail
 * an operator either wants or does not, and gg arms none that nobody wrote.
 */
export function seededRunLimits(): GgRunLimitsDraft {
  const draft = blankRunLimits();
  for (const spec of RUN_LIMIT_SPECS) {
    if (spec.defaultValue !== undefined) draft[spec.key] = spec.defaultValue;
  }
  return draft;
}

/**
 * A capability's dedicated param controls seeded to their
 * [authored values](ParamSpec.defaultValue) — every value a switched-on capability is
 * written with, in front of the operator in the form rather than applied on the way out.
 *
 * An `agent` param is skipped: its authored value ([ROOT_PROFILE_ID]) means "whichever
 * profile is the root", which is only an answer once a draft has a root to point at, and
 * [seedAgentParams] fills those in. The two required params with no value to seed are
 * skipped by having none: a `boolean` always writes the state its slider is in, and
 * responses-as-code's `language` is the operator's own answer.
 */
function seededParams(cap: CapSpec): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of cap.params ?? []) {
    if (p.kind === "agent") continue;
    if (p.kind === "toggles") {
      out[p.key] = seededToggles(p);
      continue;
    }
    if (p.defaultValue !== undefined) out[p.key] = p.defaultValue;
  }
  return out;
}

/**
 * `params` with every required control a *stored* configuration was short of filled in
 * from the catalog — the load-path half of [seededParams].
 *
 * This is the editor being helpful about a document written before a param was required,
 * or by hand, and it is deliberately done here rather than at serialization: an operator
 * opens such a configuration, sees the filled-in figures in the fields they belong to, and
 * saves a document that says what the run will do. Nothing is filled in silently on the
 * way out, so a value in the saved set is a value that was on the screen.
 *
 * Only the required ones, and only the empty ones: a param whose absence is the setting
 * stays absent, and a stored figure is never overwritten.
 */
function filledRequiredParams(
  cap: CapSpec,
  params: Record<string, string>,
): Record<string, string> {
  const out = { ...params };
  for (const p of cap.params ?? []) {
    if (!p.required || p.kind === "agent") continue;
    if (p.kind === "toggles") {
      // A toggle set's draft value is the list of members switched off, so an empty string
      // is a statement — every member on — rather than an empty field. Only a key the
      // stored configuration carried nothing readable for is seeded.
      if (!(p.key in out)) out[p.key] = seededToggles(p);
      continue;
    }
    if (p.defaultValue === undefined) continue;
    if (!(out[p.key] ?? "").trim()) out[p.key] = p.defaultValue;
  }
  return out;
}

/**
 * Point every unset `agent` param on `agent` at `rootAgentId`. The catalog spells those
 * defaults as [ROOT_PROFILE_ID] — "whichever profile is the root" — so they are seeded
 * here, where the draft's root is known, rather than taken literally.
 */
export function seedAgentParams(
  agent: GgAgentDraft,
  rootAgentId: string,
): GgAgentDraft {
  const capabilities = { ...agent.capabilities };
  for (const cap of CAPABILITIES) {
    const agentParams = (cap.params ?? []).filter(
      (p) => p.kind === "agent" && p.defaultValue === ROOT_PROFILE_ID,
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
 * The row a draft holds for a capability nothing has configured: switched off, and already
 * carrying the arm and the values it would be written with the moment it is switched on.
 *
 * Switching a capability on is one click, and it has to produce a capability that is fully
 * specified — so the specification is in the draft before the click, where the operator
 * sees it, rather than being conjured at serialization time. An id outside the catalog
 * names no capability and has nothing to seed.
 */
export function capabilityDraftFor(id: string): GgCapabilityDraft {
  const cap = capabilitySpec(id);
  if (!cap) return blankCapabilityDraft();
  return { ...defaultCapabilityDraft(cap), enabled: false };
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
    implementation: authoredImplementation(cap),
    params: seededParams(cap),
    extraParams: {},
  };
}

/**
 * The [type](GgAgentMode) a stored agent config records, read off the two mode-marker
 * capabilities. A config that names neither is a tool-calling agent.
 *
 * A machine wins over responses-as-code when a hand-written config claims both: an FSM
 * shell has no turns, so there is no reply for a program to be, and the machine is
 * unambiguously the thing that would run.
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
        tools: [],
        operations: [],
        customInstructions: "",
        systemPromptTemplate: "",
        subagents: [],
        hooks: [],
      }
    : {};
  return { ...agent, ...worker, capabilities };
}

/** A freshly identified agent-slot declaration with the given name and no default. */
export function blankModelSlot(
  name: string = "",
  passthrough: boolean = false,
): GgModelSlotDraft {
  return { id: localId("slot"), name, defaultModelId: "", passthrough };
}

/**
 * The `primary` agent slot a fresh profile is born with: passthrough, so a configuration
 * that says nothing about models still asks for one model per agent at launch without the
 * operator declaring anything.
 */
export function blankPrimaryModelSlot(): GgModelSlotDraft {
  return blankModelSlot(PRIMARY_SLOT, true);
}

/** A freshly identified configuration slot with the given name, no default and no targets. */
export function blankConfigSlot(name: string = ""): GgConfigSlotDraft {
  return { id: localId("slot"), name, defaultModelId: "", targets: [] };
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
      implementation: authoredImplementation(cap),
      // Seed the catalog's authored values, then let a built-in's own overrides win — so
      // every field shows the figure this configuration will be conducted under.
      params: { ...seededParams(cap), ...(paramDefaults[cap.id] ?? {}) },
      extraParams: {},
    };
  }
  return out;
}

/**
 * A fresh agent profile with the given capabilities on, declaring and deferring to its own
 * passthrough `primary` model slot. The name defaults to [ROOT_AGENT] — the name a first
 * profile is born with, not a name anything checks for; pass another for an added agent.
 *
 * `existing` is the configuration the profile is about to join, and is what its
 * [seeded](mintAgentSlug) slug is made unique against; a profile that starts a configuration
 * of its own joins nothing. Defaulting `name` to [ROOT_AGENT] therefore seeds
 * [ROOT_PROFILE_ID] for a default set's first profile without anything having to say so.
 *
 * The [type](GgAgentMode) is read off `enabledIds` the same way a stored config's is read
 * off its capability list, so a caller says "everything on" once and gets the agent that
 * describes — rather than having to say which type "everything" implies.
 */
export function blankAgentDraft(
  name: string = ROOT_AGENT,
  enabledIds: ReadonlyArray<string> = [],
  paramDefaults: Record<string, Record<string, string>> = {},
  existing: ReadonlyArray<GgAgentDraft> = [],
): GgAgentDraft {
  // A fresh profile declares its own passthrough `primary` slot and defers to it, so an
  // agent added to a configuration asks for one model at launch without the operator
  // declaring anything on either side.
  const primary = blankPrimaryModelSlot();
  return {
    id: mintAgentKey(),
    slug: mintAgentSlug(name, existing),
    name,
    modelSlots: [primary],
    mode: agentModeOf(
      enabledIds.map((id) => ({ id, enabled: true, params: {} })),
    ),
    capabilities: draftsFor(enabledIds, paramDefaults),
    modelSource: "model-slot",
    modelSlotId: primary.id,
    modelId: "",
    // A fresh profile is granted everything its capabilities offer, in both vocabularies
    // — the same seeding switching a capability on does, applied to the set it is born
    // with. Without it a "fresh agent, defaults on" would be an agent with eight
    // capabilities and not one call.
    ...grantsOf(enabledIds),
    customInstructions: "",
    systemPromptTemplate: "",
    promptCacheTtl: "standard",
    loopDetection: blankLoopDetection(),
    subagents: [],
    hooks: [],
    // Declared inline. A profile follows a saved agent only by being imported from one.
    source: null,
  };
}

/**
 * `draft` with the profile `agentId`'s [slug](GgAgentDraft.slug) set to `slug`.
 *
 * Nothing else moves. Every reference in the draft — a roster entry, an `agent` param, a
 * machine's state, the root flag, a configuration slot's target, the link to a saved agent
 * — points at the profile's internal [id](GgAgentDraft.id), which is minted once and never
 * rewritten. That is the whole reason the two are separate fields: renaming is an edit to
 * one string, and two profiles may carry one slug for as long as it takes an operator to
 * tell them apart again without either becoming unaddressable.
 */
export function renameAgentSlug(
  draft: GgConfigDraft,
  agentId: string,
  slug: string,
): GgConfigDraft {
  return {
    ...draft,
    agents: draft.agents.map((agent) =>
      agent.id === agentId ? { ...agent, slug } : agent,
    ),
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

/**
 * A default *display* name no profile in `agents` has taken — the label a newly added
 * profile opens on, so the operator is given something to rename rather than an empty box.
 *
 * A convenience and nothing more: names need not be unique, nothing resolves a reference by
 * reading one, and no save gate asks about this. What has to be unique is the profile's
 * [slug](mintAgentSlug), which is seeded separately.
 */
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
const ROSTER_CAP_IDS = ["subagents", "project-management", "exec"] as const;

/**
 * A whole draft around one agent: it is the root, it keeps the model slots it declares,
 * any `agent` param it carries points at it, and — if it enables anything that needs a
 * roster — it lists itself in every scope. The configuration declares no slot of its own,
 * so what the launch asks for is the agent's passthrough slots.
 */
function singleAgentDraft(agent: GgAgentDraft): GgConfigDraft {
  const needsRoster = ROSTER_CAP_IDS.some(
    (id) => agent.capabilities[id]?.enabled,
  );
  const root = seedAgentParams(
    {
      ...agent,
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
    modelSlots: [],
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
    modelSlots: agent.modelSlots.map((slot) => ({ ...slot })),
    tools: [...agent.tools],
    operations: [...agent.operations],
    subagents: agent.subagents.map((s) => ({ ...s })),
    hooks: agent.hooks.map((h) => ({ ...h })),
    source: agent.source ? { ...agent.source } : null,
  };
}

/**
 * A deep copy of a draft, so duplicating a configuration never aliases the one it came
 * from. Ids are copied as they are — a profile id is unique within a set, not across them,
 * and a duplicate is the same profiles under a second name.
 */
export function cloneDraft(draft: GgConfigDraft): GgConfigDraft {
  return {
    agents: draft.agents.map(cloneAgentDraft),
    rootAgentId: draft.rootAgentId,
    modelSlots: draft.modelSlots.map((s) => ({
      ...s,
      targets: s.targets.map((t) => ({ ...t })),
    })),
    limits: { ...draft.limits },
    hooks: draft.hooks.map((h) => ({ ...h })),
  };
}

/**
 * A blank draft: a single root agent with every catalog capability present and off,
 * declaring its own passthrough `primary` model slot and deferred to it.
 */
export function emptyDraft(): GgConfigDraft {
  return singleAgentDraft(blankAgentDraft());
}

// --- `toggles` params -----------------------------------------------------------
//
// A `toggles` param is a JSON object of independently switchable members, each with its
// gg reads such a param one of two ways, and the catalog says which on the param itself
// ([ParamSpec.toggleSet]). An `exhaustive` set — response healing's repairs, the SDK types
// a documentation lookup opens — has to name EVERY member: gg arms no member an operator
// did not write, so an object leaving one out refuses the launch. A `withholding` set —
// the skills capability's built-ins — names only what is held BACK, and a member it does
// not mention is offered; that is a reading of the object rather than a default, which is
// why `{}` is the legitimate "withhold nothing".
//
// The draft holds the ids of the members switched OFF, comma-separated, so it stays a
// plain string like every other dedicated control. It is a raw off-list rather than a set
// of deviations because there is nothing for a member to deviate FROM: what an operator
// sees in the checkboxes is the whole statement, and it is written out whole.

const TOGGLE_SEPARATOR = ",";

/**
 * The switched-**off** member ids a `toggles` draft value stands for, in catalog order —
 * what the form's checkboxes are drawn from.
 */
export function togglesOff(
  spec: ParamSpec,
  raw: string | undefined,
): ReadonlyArray<string> {
  const ids = new Set(
    (raw ?? "")
      .split(TOGGLE_SEPARATOR)
      .map((id) => id.trim())
      .filter(Boolean),
  );
  // Filtered against the catalog, so a stale id from an older client cannot switch off a
  // member that no longer exists.
  return (spec.options ?? []).map((o) => o.value).filter((id) => ids.has(id));
}

/** The draft value for a `toggles` param with exactly `off` switched off. */
export function togglesDraftValue(
  spec: ParamSpec,
  off: ReadonlyArray<string>,
): string {
  const offSet = new Set(off);
  return (spec.options ?? [])
    .map((o) => o.value)
    .filter((id) => offSet.has(id))
    .join(TOGGLE_SEPARATOR);
}

/**
 * The draft value a freshly switched-on capability's `toggles` param opens at — the
 * members the [authoring catalog](ParamSpec.options) writes as off, and nothing else.
 *
 * A starting point in front of the operator, never a fallback: what is saved is whatever
 * the checkboxes are showing by then, and gg reads no arm out of a member nobody wrote.
 */
function seededToggles(spec: ParamSpec): string {
  return togglesDraftValue(
    spec,
    (spec.options ?? []).filter((o) => o.seedOff).map((o) => o.value),
  );
}

/**
 * The draft value a *stored* `toggles` param decodes to, or `null` when the stored
 * value is not one this control can represent — in which case it is carried through the
 * [passthrough](GgCapabilityDraft.extraParams) untouched rather than shown as something
 * it is not.
 *
 * An `exhaustive` set also accepts gg's two scalar shorthands, read exactly as gg reads
 * them: `true` is every member on and `false` is every member off. An object has to name
 * every member, because that is the only object gg would launch. A `withholding` set takes
 * an object alone, and a member it leaves out is offered.
 */
function togglesFromParam(spec: ParamSpec, value: unknown): string | null {
  const options = spec.options ?? [];
  const ids = options.map((o) => o.value);
  if (spec.toggleSet === "exhaustive") {
    if (value === false) return togglesDraftValue(spec, ids);
    if (value === true) return "";
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (
    entries.some(([id, on]) => !ids.includes(id) || typeof on !== "boolean")
  ) {
    return null;
  }
  const stated = new Map(entries as Array<[string, boolean]>);
  // An exhaustive set that leaves a member out is a document gg refuses, and there is no
  // arm the editor could show for the member nobody wrote — so it goes to the passthrough
  // and the operator sees the key they have to fix.
  if (spec.toggleSet === "exhaustive" && stated.size !== ids.length)
    return null;
  return togglesDraftValue(
    spec,
    // A withholding set's unmentioned member is offered, which is the reading gg gives it.
    options.filter((o) => stated.get(o.value) === false).map((o) => o.value),
  );
}

/**
 * The JSON a `toggles` draft value writes. An `exhaustive` set names every member and the
 * state its checkbox is in; a `withholding` set names the switched-off ones alone, and
 * writes `{}` when none of them is.
 */
function togglesToParam(spec: ParamSpec, raw: string): Record<string, boolean> {
  const off = new Set(togglesOff(spec, raw));
  const out: Record<string, boolean> = {};
  for (const option of spec.options ?? []) {
    const on = !off.has(option.value);
    if (on && spec.toggleSet === "withholding") continue;
    out[option.value] = on;
  }
  return out;
}

// --- `states` params (the FSM machine) ------------------------------------------
//
// A `states` param is a whole finite-state machine: an ordered list of states, the
// first of which is the one the machine enters, each naming an agent profile to run and
// the edges out of it. It is held as the JSON *text* of the list, so the draft stays a
// flat `Record<string, string>` and a half-written state survives a re-render — but
// unlike every other param it carries cross-references, of two different kinds: a state
// names an agent profile (by that profile's [id](GgAgentDraft.id)), and a transition names
// a sibling *state* (by the state's name, because a state's identity in the machine IS its
// name — it is what the model passes to `transition_state`, and what gg's own validation
// resolves).
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
   * The [id](GgAgentDraft.id) of the agent profile this state runs — the same id the stored
   * machine carries, so nothing has to be resolved on the way in or out. Empty when the
   * state names none, which is a save-blocking error.
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
 */
function statesFromParam(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const states: StateDraft[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return null;
    }
    const { name, agentId, transitions, ...rest } = entry as Record<
      string,
      unknown
    >;
    if (Object.keys(rest).length) return null;
    if (typeof name !== "string") return null;
    if (agentId !== undefined && typeof agentId !== "string") return null;
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
    states.push({ name, agentId: agentId ?? "", transitions: edges });
  }
  return statesDraftValue(states);
}

/**
 * The JSON a `states` draft value writes, or `undefined` when it declares no state at
 * all (which writes no param — the arm gg refuses at launch, and which the editor
 * refuses to save, but which is a legitimate half-built state to hold).
 */
function statesToParam(
  raw: string,
): Array<Record<string, unknown>> | undefined {
  const states = statesFromDraft(raw);
  if (!states.length) return undefined;
  return states.map((state) => ({
    name: state.name.trim(),
    agentId: state.agentId,
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
 * Every reference the config holds to another profile is already the id the draft works in,
 * so only the model-slot bindings are resolved here, against the slots the profile itself
 * declares. The roster is left to a second pass ([resolveAgentReferences]), which needs the
 * set to know which of its entries point at a profile the configuration actually declares.
 */
export function agentDraftFromConfig(agent: GgAgentConfig): GgAgentDraft {
  const modelSlots: GgModelSlotDraft[] = (agent.modelSlots ?? []).map(
    (slot) => ({
      id: localId("slot"),
      name: slot.name,
      defaultModelId: slot.defaultModelId ?? "",
      passthrough: Boolean(slot.passthrough),
    }),
  );
  // A binding may name a slot the stored profile never declared. Declare it here so the
  // binding points at something real rather than opening as an unexplained blank; the save
  // gate then reports it as the passthrough-or-mapped choice the operator still owes.
  const declare = (name: string | undefined): string => {
    const trimmed = name?.trim();
    if (!trimmed) return "";
    const found = modelSlots.find((slot) => slot.name === trimmed);
    if (found) return found.id;
    const added = { ...blankModelSlot(trimmed), id: localId("slot") };
    modelSlots.push(added);
    return added.id;
  };
  const slotIdByName = new Map<string, string>();
  const slotIdFor = (name: string): string => {
    const existing = slotIdByName.get(name);
    if (existing) return existing;
    const id = declare(name);
    if (id) slotIdByName.set(name, id);
    return id;
  };
  for (const slot of modelSlots) slotIdByName.set(slot.name, slot.id);
  const stored = new Map(
    (agent.capabilities ?? []).map((cap) => [cap.id, cap] as const),
  );
  const capabilities: Record<string, GgCapabilityDraft> = {};
  for (const cap of CAPABILITIES) {
    const from = stored.get(cap.id);
    if (!from) {
      // A capability the stored configuration does not mention is off, and is seeded the
      // way a fresh one is, so switching it on here is switching on a specified capability.
      capabilities[cap.id] = capabilityDraftFor(cap.id);
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
        params[key] = name ? slotIdFor(name) : "";
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
        // Both states are held explicitly, because for a required flag both are written:
        // the slider's position IS the value, and there is no third thing an absent key
        // could mean.
        if (typeof value !== "boolean") extraParams[key] = value;
        else params[key] = value ? "true" : "false";
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
    // What the stored configuration was short of, filled in from the catalog so the
    // operator opens on a form that shows what the run would do — an arm for a capability
    // that has to name one, and a figure for every required param that had none. Both are
    // visible in their own controls, and both are saved back as what they say.
    const implementation = from.implementation ?? "";
    capabilities[cap.id] = {
      enabled: from.enabled,
      implementation:
        !implementation.trim() && requiresImplementation(cap)
          ? authoredImplementation(cap)
          : implementation,
      params: filledRequiredParams(cap, params),
      extraParams,
    };
  }
  const mode = agentModeOf(agent.capabilities ?? []);
  // The allowlist the stored configuration wrote, and — for the vocabulary it did not
  // write, because gg reads only one — the seeding the editor would have applied to the
  // capabilities it has on.
  //
  // Both halves have to be populated because the type selector is live: an operator who
  // switches a stored Tools agent to RaC and saves must get the same capabilities in the
  // other surface's vocabulary, not an agent granted nothing. Seeding it from the enabled
  // capabilities is the same answer switching each of them on would have given, and it is
  // scratch until the type actually changes — [agentConfigFromDraft] records only the half
  // the agent's type reads, so a round-trip through the editor writes back exactly what
  // was loaded.
  const seeded = grantsOf(
    (agent.capabilities ?? []).filter((c) => c.enabled).map((c) => c.id),
  );
  // The type first, then the capabilities its type does not read wound back to the
  // catalog's defaults: a stored agent carries one type's configuration and no other, so
  // there is nothing for the rest of them to be loaded *from*.
  return resetAgentForMode({
    // A stored configuration carries its ids; a launched set has had them resolved away, and
    // one opened for reading is minted a fresh one so the draft's references have something
    // to point at.
    id: agent.id ?? mintAgentKey(),
    slug: agent.slug,
    name: agent.name,
    modelSlots,
    mode,
    capabilities,
    modelSource: agent.modelSlot ? "model-slot" : "model",
    modelSlotId: agent.modelSlot?.trim()
      ? slotIdFor(agent.modelSlot.trim())
      : "",
    modelId: agent.modelId ?? "",
    tools: mode === "tools" ? [...(agent.tools ?? [])] : seeded.tools,
    operations:
      mode === "rac" ? [...(agent.operations ?? [])] : seeded.operations,
    customInstructions: agent.customInstructions ?? "",
    systemPromptTemplate: agent.systemPromptTemplate ?? "",
    // A configuration that names no lifetime reads as the standard one, which is the
    // same reading gg gives it.
    promptCacheTtl: agent.promptCacheTtl ?? "standard",
    loopDetection: loopDetectionDraft(agent.loopDetection),
    // Keyed by the profile's id rather than its name: two profiles may share a name, and
    // the hook row ids have to be unique across the whole form.
    hooks: (agent.hooks ?? []).map((hook, index) =>
      hookDraft(hook, `${agent.id}-${index}`),
    ),
    // Filled in by [resolveAgentReferences], which needs the ids the set declares.
    subagents: [],
    // Whether this profile follows a saved agent is recorded on the configuration
    // rather than in the capability set, so it is attached after the load
    // ([attachAgentSources]) rather than read off the agent.
    source: null,
  });
}

/**
 * Fill one agent's roster from the stored config it was loaded from, against `declared` —
 * the [ids](GgAgentDraft.id) the configuration around it declares.
 *
 * A roster entry pointing at a profile the set does not declare is **dropped**: gg refuses
 * such a set at launch, and the roster is the one reference the editor draws target-first
 * (a row per declared profile), so an entry naming none would be a reference no control
 * could show, edit or remove. Every other reference — an `agent` param, a
 * [machine](StateDraft)'s states — is kept verbatim whether or not it resolves, because
 * those *are* drawn reference-first and say so on the row when they point at nothing.
 */
export function resolveAgentReferences(
  draft: GgAgentDraft,
  stored: GgAgentConfig,
  declared: ReadonlySet<string>,
): GgAgentDraft {
  return {
    ...draft,
    subagents: (stored.subagents ?? []).flatMap((s) =>
      declared.has(s.agentId)
        ? [
            {
              agentId: s.agentId,
              description: s.description ?? "",
              // Exactly what the entry names, and nothing where it names nothing: gg
              // grants none of the three roles on an operator's behalf, so an entry short
              // of them is a launch it refuses rather than a plain spawner.
              scopes: [...(s.scopes ?? [])],
            },
          ]
        : [],
    ),
  };
}

/**
 * Fill a draft from a stored capability set. A set with no agents (which a launch
 * refuses, and which nothing the editor writes can produce) is given a fresh one, so
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
            slug: ROOT_PROFILE_ID,
            name: ROOT_AGENT,
            capabilities: DEFAULT_CAP_IDS.map((id) => ({
              id,
              enabled: true,
              params: {},
            })),
            modelId: "",
          },
        ];
  const agents = stored.map(agentDraftFromConfig);
  // A configuration slot names its targets by the profile's internal id and the slot's
  // name; the draft points at the target slot's editor-only id so renaming a slot carries
  // the mapping along.
  const slotIdOn = (agentId: string, slotName: string): string | null =>
    agents
      .find((a) => a.id === agentId)
      ?.modelSlots.find((slot) => slot.name === slotName)?.id ?? null;
  const modelSlots: GgConfigSlotDraft[] = (set.modelSlots ?? []).map((s) => ({
    id: localId("slot"),
    name: s.name,
    defaultModelId: s.defaultModelId ?? "",
    targets: (s.targets ?? []).flatMap((t) => {
      const slotId = slotIdOn(t.agent, t.slot);
      return slotId ? [{ agentId: t.agent, slotId }] : [];
    }),
  }));
  const declared = new Set(agents.map((agent) => agent.id));
  const rootAgentId = agents[0]!.id;
  return {
    agents: agents.map((agent, i) =>
      // [seedAgentParams] fills only the `agent` params that are *unset*, which after the
      // load is exactly the ones a capability the agent's type does not read was wound
      // back to its default. A stored value is already an id and is left alone.
      seedAgentParams(
        resolveAgentReferences(agent, stored[i]!, declared),
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
    // Filled in when a stored command hook named none: gg kills a hook at the ceiling the
    // hook declares and has none of its own to lend one that declares nothing, so the
    // figure goes in the field where the operator can see and change it.
    timeoutSecs:
      action.type !== "command"
        ? ""
        : String(action.timeoutSecs ?? AUTHORED_HOOK_TIMEOUT_SECS),
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
    timeoutSecs: String(AUTHORED_HOOK_TIMEOUT_SECS),
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
 *
 * A command hook's timeout is the one field here that is not optional — gg has no ceiling
 * of its own to run a hook that declares none under — so it is always written. The two
 * that stay optional are inheritance rather than substitution: an absent `cwd` runs the
 * command in the agent's own workspace root, and an absent `output` follows the agent's own
 * shell configuration. [hookErrors] is what keeps an unwritable timeout from reaching here.
 */
function hooksFromDraft(hooks: GgHookDraft[]): GgHook[] {
  return hooks.flatMap((hook): GgHook[] => {
    const name = hook.name.trim();
    const base = name ? { name } : {};
    if (hook.kind === "command") {
      const command = hook.command.trim();
      if (!command) return [];
      const cwd = hook.cwd.trim();
      // An empty field is not a zero: `Number("")` is `0`, which would write a hook gg
      // kills the instant it starts.
      const declared = hook.timeoutSecs.trim();
      const timeout = declared ? Number(declared) : Number.NaN;
      const output = hook.output.trim();
      return [
        {
          ...base,
          event: hook.event,
          action: {
            type: "command" as const,
            command,
            ...(cwd ? { cwd } : {}),
            timeoutSecs: Number.isFinite(timeout)
              ? timeout
              : AUTHORED_HOOK_TIMEOUT_SECS,
            ...(output ? { output } : {}),
          },
        },
      ];
    }
    if (hook.kind === "built-in") {
      const script = hook.script.trim();
      if (!script) return [];
      return [
        {
          ...base,
          event: hook.event,
          action: { type: "built-in" as const, script },
        },
      ];
    }
    const source = hook.source.trim();
    if (!source) return [];
    return [
      {
        ...base,
        event: hook.event,
        action: { type: "custom" as const, source },
      },
    ];
  });
}

/**
 * A stored ceiling set as the form's text fields. An absent optional ceiling stays the
 * empty string — the form's own spelling of "unarmed" — and an absent
 * [required](RunLimitSpec.required) one is filled in from the catalog, so an older
 * configuration written before those two were required opens with the figures in their
 * fields rather than with a save the operator cannot make.
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
    if (value === undefined) {
      if (spec.required && spec.defaultValue !== undefined) {
        draft[spec.key] = spec.defaultValue;
      }
      continue;
    }
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
 * `enabled` is whether this capability is *on* for the agent, and it is what decides
 * whether the required params are required: requirement is a property of the switch, so a
 * capability that is off is short of nothing. Its params are still written — that is what
 * keeps the on and off arms of one comparison the same document with one switch moved —
 * but an empty control on one writes no key rather than refusing the save.
 *
 * An `agent` param needs no resolving in either direction: its draft value is the profile
 * [id](GgAgentDraft.id) gg reads. `slotName` turns a `model` param's deferred half back into
 * the slot name the wire carries; omit it to check the params without resolving anything
 * (the validation path), which leaves such a value as it is.
 */
export function capabilityParams(
  cap: CapSpec,
  draft: GgCapabilityDraft,
  enabled: boolean,
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
    // The three kinds that write whatever state their control is in, empty or not: a
    // toggle set that has moved nothing is an empty object, a slider that is off is
    // `false`, and a machine with no states is an empty list. Each is a value the operator
    // can see on the screen, so none of them is a hole — but on a capability that is off
    // there is nothing to state, and the key is left out.
    //
    // `stated` is what keeps that from overwriting a *stored* value this control cannot
    // represent, which the passthrough is already carrying under the same key: such a
    // value satisfies the requirement by being there, and replacing it with the empty
    // state would drop what the operator could not see and did not change.
    const stated = p.required && enabled && !(p.key in out);
    if (p.kind === "toggles") {
      // A toggle set states its whole membership, so it writes what the checkboxes are
      // showing whichever way the capability's switch is sitting — the off arm carries the
      // configuration the on arm would have used. The exception is the stored value this
      // control could not represent, which the passthrough already holds under this key
      // and the operator never saw to change.
      if (!(p.key in out)) out[p.key] = togglesToParam(p, raw);
      continue;
    }
    if (p.kind === "boolean") {
      if (raw === "true") out[p.key] = true;
      else if (stated) out[p.key] = false;
      continue;
    }
    if (p.kind === "states") {
      const states = statesToParam(raw);
      if (states) out[p.key] = states;
      else if (stated) out[p.key] = [];
      continue;
    }
    if (!raw) {
      // gg substitutes nothing, so an empty required control is a launch that would be
      // refused. The form refuses the save instead, where it is still one field to fill in
      // rather than a run that never started. An optional param's empty control is the
      // setting — no summarizer model, no reviewer requirement — and writes no key.
      if (p.required && enabled) {
        return { ok: false, error: `${p.label} needs a value.` };
      }
      continue;
    }
    // Every one of these is already the string gg reads — an `agent` param's value is the
    // target profile's [id](GgAgentDraft.id), a `model` param's is a pinned model id.
    if (
      p.kind === "agent" ||
      p.kind === "model" ||
      p.kind === "select" ||
      p.kind === "text"
    ) {
      out[p.key] = raw;
      continue;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      return { ok: false, error: `${p.label} must be a number.` };
    }
    if (p.kind === "fraction" && (n < 0 || n > 1)) {
      return { ok: false, error: `${p.label} must be between 0 and 1.` };
    }
    // A share of a window is between none of it and all of it. Caught here rather than
    // left to the launch for the same reason the fraction above is: it is one field to
    // correct on the screen, not a run that never started.
    if (p.kind === "percent" && (n < 0 || n > 100)) {
      return { ok: false, error: `${p.label} must be between 0 and 100.` };
    }
    out[p.key] = n;
  }
  return { ok: true, value: out };
}

// --- The call allowlists --------------------------------------------------------
//
// gg grants an agent its calls by **allowlist**, in two independent vocabularies
// ([GgAgentDraft.tools] and [GgAgentDraft.operations]), and an absent name is a call the
// agent does not have. The editor never shows an operator a list of raw call names,
// because a list of forty is not a control anybody uses; it shows the two granularities
// that mean something — the capability, and the coherent sub-feature — and writes the
// allowlist entries behind them.
//
// So the allowlist an operator ends up with is composed here rather than typed: switching
// a capability on grants everything it offers, switching it off takes all of that back,
// and a feature slider moves its own bundle within that. What looks from the outside like
// "everything is on by default" is exactly this seeding — there is no runtime default
// that means everything, and gg supplies none.

/** The two allowlists, as every operation below hands them back. */
export interface GgCallGrants {
  tools: string[];
  operations: string[];
}

// `names` with `add`ed or removed, keeping the order the list is already in and appending
// what is new — so a granted set reads in the order it was granted rather than being
// re-sorted under the operator on every toggle.
function withNames(
  names: ReadonlyArray<string>,
  change: ReadonlyArray<string>,
  on: boolean,
): string[] {
  if (!on) return names.filter((name) => !change.includes(name));
  const next = [...names];
  for (const name of change) if (!next.includes(name)) next.push(name);
  return next;
}

/**
 * Everything the capabilities `enabledIds` names offer, in both vocabularies and catalog
 * order — the grant a freshly-made profile is born with, and the whole of what switching
 * those capabilities on would have seeded.
 *
 * A [mode marker](isModeCapability) seeds nothing, whatever names it declares, because it
 * is not a capability an agent holds — it is the [agent type](GgAgentMode) itself, and
 * `enabledIds` carries it for exactly that reason: the type is read off the same list. The
 * one marker with a surface is `fsm`, which names `transition_state` so the analyze page
 * can file the call under the machine that buys it; gg offers that call from wherever an
 * instance *stands*, never from the shell's own grant, so seeding it here would write an
 * allowlist entry no run has ever read. Filtered at the source rather than trusted to be
 * cleared downstream: [resetAgentForMode] does empty a machine's allowlists on commit, but
 * that is a rule about machines, and a marker that stopped implying one — or a worker type
 * that gained a marker — would quietly start shipping the entry to the wire.
 */
export function grantsOf(enabledIds: ReadonlyArray<string>): GgCallGrants {
  const on = CAPABILITIES.filter(
    (cap) => enabledIds.includes(cap.id) && !isModeCapability(cap.id),
  );
  return {
    tools: on.flatMap((cap) => [...(cap.tools ?? [])]),
    operations: on.flatMap((cap) => [...(cap.operations ?? [])]),
  };
}

/**
 * `agent`'s allowlists with one capability's whole offering granted (`on`) or taken back.
 *
 * This is what a capability toggle writes beside `enabled`, and the pairing is the point:
 * a capability that is on but grants nothing is an agent with a memory store and no way
 * to read it, which is not a state any operator means to configure. Turning it off again
 * clears its entries rather than leaving them behind, so a capability's own sliders start
 * from the full set the next time it is switched on — which is also the only way back
 * from a stored configuration that named none of a capability's calls.
 */
export function withCapabilityGrants(
  agent: GgAgentDraft,
  cap: CapSpec,
  on: boolean,
): GgCallGrants {
  return {
    tools: withNames(agent.tools, cap.tools ?? [], on),
    operations: withNames(agent.operations, cap.operations ?? [], on),
  };
}

/**
 * What `offer` — a capability, or one of its feature bundles — names in the vocabulary
 * this agent's [type](GgAgentMode) reads, paired with the half of the agent's own
 * allowlist written in that same vocabulary.
 *
 * Every question about what an agent actually *holds* is asked of one vocabulary: the one
 * its run will be conducted in. The other half agrees by construction — every grant
 * operation above writes both — so the choice only matters for a draft loaded from a
 * configuration written by hand, where the half nobody stored is the half that was
 * seeded. Pairing the two here rather than at each call site is what keeps a reader from
 * having to check, question by question, that the right allowlist was matched against the
 * right names: the two are not the same names, and nothing but the pairing says so.
 */
function inAgentVocabulary(
  agent: GgAgentDraft,
  offer: { tools?: ReadonlyArray<string>; operations?: ReadonlyArray<string> },
): [granted: ReadonlyArray<string>, offered: ReadonlyArray<string>] {
  return agent.mode === "rac"
    ? [agent.operations, offer.operations ?? []]
    : [agent.tools, offer.tools ?? []];
}

/**
 * Whether one of a capability's [feature](CapSpec.features) sliders reads as on: every
 * call the bundle names is granted, in the vocabulary this agent answers on.
 */
export function featureBundleOn(
  agent: GgAgentDraft,
  bundle: { tools: ReadonlyArray<string>; operations: ReadonlyArray<string> },
): boolean {
  const [granted, names] = inAgentVocabulary(agent, bundle);
  return names.every((name) => granted.includes(name));
}

/**
 * Why a capability that is switched on can call nothing, or `null` when it can.
 *
 * This is the failure the allowlist makes silent. A capability whose every call has been
 * switched off is still *on*: the switch reads as configured, the params are all there,
 * and the agent runs with a surface it can never reach. Nothing downstream says so
 * either — the run record shows a model that called none of it, which is exactly what a
 * model that simply chose not to use it looks like. So it is said here, on the card, while
 * it is still an edit and not yet a run.
 *
 * A warning and not a save error: gg launches such a configuration perfectly happily, and
 * the editor cannot tell a slip from an operator deliberately parking a capability's whole
 * surface between the arms of a study while its params stay authored. So it says so, and
 * gets out of the way.
 *
 * Nothing is said about a capability that is off, and nothing about one that offers no
 * calls *in this agent's vocabulary* — a great many are pure settings with no surface at
 * all (`autoload-specs`, `context-window-override`), and a capability whose whole surface
 * is in the other vocabulary (`docview-close` buys operations and no tool) offers this
 * type nothing to grant either. Every one of those is working exactly as configured, and
 * a warning that fires on them is how an operator learns to read past the one that means
 * something.
 *
 * And nothing at all about a [mode marker](isModeCapability), whatever names it declares.
 * A marker is the [agent type](GgAgentMode) itself rather than a feature of one: no
 * allowlist is ever seeded from what it names ([grantsOf] skips it), and an FSM shell's two
 * allowlists are emptied outright when it is committed
 * ([resetAgentForMode]). `fsm` declares `transition_state` only so the analyze page can
 * name the call under the machine that buys it — gg offers that call from where an
 * instance stands, not from the shell's grant — so "on, and holding none of what it
 * offers" is true of every machine there has ever been, and the advice below is
 * unfollowable on one: a marker has no feature slider to turn back on, and no switch to
 * turn off but the type selector. Asked of the marker rather than of `fsm` by name so
 * that a second one cannot bring the warning back.
 */
export function capabilityGrantWarning(
  agent: GgAgentDraft,
  cap: CapSpec,
): string | null {
  if (isModeCapability(cap.id)) return null;
  if (!capabilityActive(agent, cap)) return null;
  const [granted, offered] = inAgentVocabulary(agent, cap);
  if (!offered.length) return null;
  if (offered.some((name) => granted.includes(name))) return null;
  // Named in the vocabulary the operator is looking at: a Tools agent's card is a list of
  // tools and a code agent's is a list of operations, and the warning has to be about the
  // thing on the screen.
  const [all, one] =
    agent.mode === "rac" ? ["operations", "operation"] : ["tools", "tool"];
  return `All ${all} disabled — this capability is on, but every ${one} it offers has been withheld, so the agent can never use it. Turn a feature back on, or turn the capability off.`;
}

/** `agent`'s allowlists with a whole feature bundle granted (`on`) or taken back. */
export function setFeatureBundle(
  agent: GgAgentDraft,
  bundle: { tools: ReadonlyArray<string>; operations: ReadonlyArray<string> },
  on: boolean,
): GgCallGrants {
  return {
    tools: withNames(agent.tools, bundle.tools, on),
    operations: withNames(agent.operations, bundle.operations, on),
  };
}

// --- Run limits -----------------------------------------------------------------

/**
 * Why a draft's execution ceilings cannot be saved, or `null` when they are
 * well-formed.
 */
export function runLimitsError(limits: GgRunLimitsDraft): string | null {
  for (const spec of RUN_LIMIT_SPECS) {
    const raw = limits[spec.key].trim();
    if (!raw) {
      // The two ceilings a run cannot be conducted without. Every other empty field is
      // that ceiling unarmed, which is a setting rather than a gap.
      if (spec.required) {
        return `${spec.label} is required — every run has one, and gg supplies no figure for it.`;
      }
      continue;
    }
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
  // A half-declared error-rate ceiling is well-formed and means nothing is armed: the
  // rate and its window stand or fall together, and gg does not lend the missing half.
  // Refusing to save one here would make the editor stricter than the contract, which
  // accepts it and says at launch that the ceiling is inert.
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
  if (!limits.maxTurns.trim()) return null;
  const turns = Number(limits.maxTurns.trim());
  if (!Number.isFinite(turns) || window < turns) return null;
  return `The error-rate window (${window}) isn't smaller than the turn ceiling (${turns}), so the rate ceiling could only ever fire on the last turn an agent is allowed.`;
}

/**
 * A draft's ceilings as the wire shape. The two required ones are always in it — a saved
 * configuration cannot be short of them ([runLimitsError]) — so the `undefined` arm is
 * reachable only from a draft assembled by something other than this editor. A
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
 * A stored declaration as the editor holds it — every knob it named as text, every knob it
 * did not as an empty field. `undefined`, an agent that left the lever alone, loads
 * disarmed, which is exactly gg's own reading of an absent key.
 *
 * An **armed** stored declaration short of a knob is [filled in](armLoopDetection): the
 * five knobs are the rule, gg has no figure to lend for a missing one, and the operator
 * has to see what the detector would run on before saving it back.
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
    // than falsiness — `?? ""` would turn "abandon as soon as the window saturates" into
    // an empty field.
    if (value !== undefined) draft.knobs[spec.key] = String(value);
  }
  return draft.enabled ? armLoopDetection(draft) : draft;
}

/**
 * `draft` armed, with every knob it is short of seeded to its
 * [authored figure](LoopDetectionSpec.authored).
 *
 * Arming is what makes the five knobs required — the rule trips on the five of them
 * together, and a detector armed on figures nobody chose would measure gg rather than the
 * model — so this is where the figures go into the fields, at the moment the switch moves
 * and where the operator can retune them. A knob already carrying a value is left alone,
 * including one an operator tuned before disarming the detector.
 */
export function armLoopDetection(
  draft: GgLoopDetectionDraft,
): GgLoopDetectionDraft {
  const knobs = { ...draft.knobs };
  for (const spec of LOOP_DETECTION_SPECS) {
    if (!knobs[spec.key].trim()) knobs[spec.key] = String(spec.authored);
  }
  return { ...draft, enabled: true, knobs };
}

/**
 * The `loopDetection` key an agent writes, spread into its wire config — or nothing at
 * all when the agent is disarmed and named no knob, so a configuration that never touched
 * the lever round-trips byte for byte.
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
 * Two things: that an **armed** detector names all five knobs, which gg requires of one
 * because the rule is the five of them together and it has no figure to lend for a missing
 * one; and that a knob that is written is a whole, non-negative count of words,
 * occurrences or characters. Everything gg merely warns about — a window of zero, more
 * offenders than the window can hold — is armed exactly as declared and left to gg, and
 * refusing the save for those would be the console being stricter than the thing it
 * configures.
 *
 * A disarmed agent's knobs are checked for shape but not for presence: it owes none, and
 * the ones it carries are still recorded, so a value that could never be read back is
 * still a value the operator will find later.
 */
export function loopDetectionError(draft: GgLoopDetectionDraft): string | null {
  for (const spec of LOOP_DETECTION_SPECS) {
    const raw = draft.knobs[spec.key].trim();
    if (!raw) {
      if (draft.enabled) {
        return `${spec.label} needs a value while loop detection is armed.`;
      }
      continue;
    }
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
    const draft = agent.capabilities[cap.id] ?? capabilityDraftFor(cap.id);
    // The arm first, because a capability that names none is short of the one value that
    // decides which of its params are read at all.
    if (requiresImplementation(cap) && !(draft.implementation ?? "").trim()) {
      errors[cap.id] =
        `${cap.implementationLabel ?? "Implementation"} needs a value.`;
      continue;
    }
    const parsed = capabilityParams(cap, draft, true);
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
 * The [ids](GgModelSlotDraft.id) of the model slots this agent's bindings actually defer
 * to: its own model binding, and every [`model` param](MODEL_PARAMS) its
 * [type](GgAgentMode) reads. A declared-but-unreferenced slot feeds nothing, so it is
 * never written and never asked about at launch (and the editor flags it).
 */
export function referencedModelSlots(agent: GgAgentDraft): Set<string> {
  const out = new Set<string>();
  // A machine binds no model at all, so a slot it was pointed at under an earlier type
  // feeds nothing and must not become a launch input.
  if (
    !isFsmShell(agent) &&
    agent.modelSource === "model-slot" &&
    agent.modelSlotId
  ) {
    out.add(agent.modelSlotId);
  }
  for (const { capId, slotKey } of MODEL_PARAMS) {
    // A slot named by a capability the agent's type does not read is named by nothing
    // that will be saved, so it feeds no launch input either.
    const cap = capabilitySpec(capId);
    if (!cap || !capabilityAppliesToMode(cap, agent.mode)) continue;
    const slotId = agent.capabilities[capId]?.params?.[slotKey];
    if (slotId) out.add(slotId);
  }
  return out;
}

/**
 * The gg capability behind the "an issue filer needs someone to assign to" rule below,
 * and the one call that files an issue — in both vocabularies, because which of the two
 * decides depends on the agent's [type](GgAgentMode). Spelled once so the rule and the
 * catalog cannot drift.
 */
const PROJECT_MANAGEMENT_CAP_ID = "project-management";
const CREATE_ISSUE_TOOL = "create_issue";
const CREATE_ISSUE_OPERATION = "board.create_issue";

/**
 * Why one list of hooks cannot be saved, or `null` when every one of them is well-formed.
 *
 * The one required field is a command hook's timeout: gg kills a hook at the ceiling the
 * hook declares and has none of its own for one that declares nothing, so a hook without
 * one is a hook gg would refuse. A hook with no command line at all is not checked — it is
 * an editing state, and [hooksFromDraft] drops it rather than putting a hook on the run
 * that fires and does nothing.
 */
export function hookErrors(hooks: ReadonlyArray<GgHookDraft>): string | null {
  for (const hook of hooks) {
    if (hook.kind !== "command" || !hook.command.trim()) continue;
    const raw = hook.timeoutSecs.trim();
    const label = hook.name.trim() || hook.command.trim();
    if (!raw) {
      return `The \`${label}\` hook needs a timeout — gg has no ceiling of its own to run it under.`;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
      return `The \`${label}\` hook's timeout must be a whole number of seconds.`;
    }
  }
  return null;
}

/**
 * Whether `agent` can file board issues: the project-management capability is on and its
 * allowlist grants the call that files one, asked of the surface this agent answers on.
 */
function filesIssues(agent: GgAgentDraft): boolean {
  const board = capabilitySpec(PROJECT_MANAGEMENT_CAP_ID);
  if (!board || !capabilityActive(agent, board)) return false;
  return agent.mode === "rac"
    ? agent.operations.includes(CREATE_ISSUE_OPERATION)
    : agent.tools.includes(CREATE_ISSUE_TOOL);
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
  if (!agent.name.trim()) return "This agent needs a name.";
  if (!isValidAgentSlug(agent.slug))
    return "A slug is lowercase letters and digits in groups separated by single hyphens — the model is shown this name and passes it back.";
  if (draft.agents.filter((a) => a.slug === agent.slug).length > 1)
    return "Another agent in this configuration carries this slug — the model would be shown one name for two profiles.";
  const ownSlots = agent.modelSlots.map((slot) => slot.name.trim());
  if (ownSlots.some((name) => !name)) return "Every model slot needs a name.";
  if (new Set(ownSlots).size !== ownSlots.length)
    return "Model slot names must be unique within an agent.";
  // A machine takes no turns, so it runs no model and has no replies to watch: its
  // loop-detection draft is reset on commit and shown by no control, and reporting a
  // fault in a value nothing can see or read would be unfixable.
  if (!isFsmShell(agent)) {
    const loop = loopDetectionError(agent.loopDetection);
    if (loop) return loop;
  }
  const hook = hookErrors(agent.hooks);
  if (hook) return hook;
  const failed = Object.entries(agentParamErrors(agent, draft.agents)).find(
    ([, error]) => error !== null,
  );
  return failed ? failed[1] : null;
}

/**
 * Why a draft cannot be saved, or `null` when it is well-formed. A *saved*
 * configuration may still be waiting on its models — that is what a model slot is for
 * — so this rejects only an agent-less configuration, a nameless or doubly-identified
 * profile, a broken model-slot declaration, a *worker* deferred to a model slot that was
 * never declared, a pinned worker with no model, an issue filer with nobody to assign
 * issues to, and unparseable params.
 *
 * A roster reference cannot dangle here — removing an agent takes every reference to it
 * along — so there is nothing to check for.
 */
/**
 * Whether `slug` is a well-formed agent slug: groups of lowercase letters and digits
 * separated by single hyphens. Mirrors gg's own rule, because the slug is what the model
 * is shown and passes back.
 */
export function isValidAgentSlug(slug: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug);
}

/**
 * The agent-slot [name](GgModelSlotDraft.name) errors and the mapping errors between the
 * configuration's launch inputs and the agent slots they fill, or `null` when the whole
 * mapping is sound.
 *
 * The rule the messages come back to: an agent slot reaches the launch form either because
 * a configuration slot names it or because it is passthrough, and never both. One that
 * reaches it neither way leaves its bindings with no model.
 */
export function slotMappingError(draft: GgConfigDraft): string | null {
  const names = draft.modelSlots.map((s) => s.name.trim());
  if (names.some((n) => !n)) return "Every configuration slot needs a name.";
  if (new Set(names).size !== names.length)
    return "Configuration slot names must be unique.";

  // How many configuration slots fill each agent slot, keyed by agent id and slot id.
  const fills = new Map<string, number>();
  const key = (agentId: string, slotId: string) => `${agentId}\u0000${slotId}`;
  for (const slot of draft.modelSlots) {
    for (const target of slot.targets) {
      const agent = draft.agents.find((a) => a.id === target.agentId);
      const declared = agent?.modelSlots.find((s) => s.id === target.slotId);
      if (!agent || !declared) {
        return `The \`${slot.name.trim()}\` configuration slot fills a slot that no longer exists — point it at a slot one of this configuration's agents declares, or remove it.`;
      }
      if (declared.passthrough) {
        return `The \`${declared.name.trim()}\` slot on \`${agent.name.trim()}\` is passthrough and is also filled by the \`${slot.name.trim()}\` configuration slot, so a launch would ask for it twice — clear the passthrough, or drop the mapping.`;
      }
      const k = key(target.agentId, target.slotId);
      fills.set(k, (fills.get(k) ?? 0) + 1);
    }
  }

  const exposed = new Set(names);
  for (const agent of draft.agents) {
    const own = agent.modelSlots.map((s) => s.name.trim());
    if (own.some((n) => !n))
      return `Every model slot on \`${agent.name.trim()}\` needs a name.`;
    if (new Set(own).size !== own.length)
      return `Model slot names must be unique within \`${agent.name.trim()}\`.`;
    const referenced = referencedModelSlots(agent);
    for (const slot of agent.modelSlots) {
      // A declared slot nothing binds is not written out, so it asks for nothing and owes
      // nothing. The editor flags it beside the declaration instead.
      if (!referenced.has(slot.id)) continue;
      const count = fills.get(key(agent.id, slot.id)) ?? 0;
      if (count > 1) {
        return `The \`${slot.name.trim()}\` slot on \`${agent.name.trim()}\` is filled by ${count} configuration slots — exactly one launch input supplies each binding.`;
      }
      if (count === 0 && !slot.passthrough) {
        return `The \`${slot.name.trim()}\` slot on \`${agent.name.trim()}\` reaches no launch input — map a configuration slot onto it, or mark it passthrough.`;
      }
      if (slot.passthrough) {
        const exposedAs = passthroughSlotName(agent.slug, slot.name.trim());
        if (exposed.has(exposedAs)) {
          return `Two launch inputs would be named \`${exposedAs}\` — rename the configuration slot, since a passthrough slot takes its name from the agent that declares it.`;
        }
        exposed.add(exposedAs);
      }
    }
  }
  return null;
}

export function draftSaveError(draft: GgConfigDraft): string | null {
  // Emptying the agent list is a legitimate editing state (it is how every profile gets
  // replaced); saving one is not, because a run has to have something to start.
  if (draft.agents.length === 0)
    return "A configuration needs at least one agent.";
  if (!rootAgent(draft)) return "One agent must be the root agent.";
  if (draft.agents.some((a) => !a.name.trim()))
    return "Every agent needs a name.";
  // Two profiles sharing a *name* is fine — a name is prose, and nothing resolves a
  // reference by reading one. The other two are not.
  //
  // A repeated **internal id** makes every reference in the configuration name both profiles
  // at once. It is unreachable from the editor, which mints one per profile and never
  // rewrites one, so it is only ever a hand-written set saying two things at one address.
  //
  // A repeated **slug** is reachable, and is meant to be: an import arrives under the saved
  // agent's own slug, and the operator clears the clash by renaming either side. It is
  // refused because the slug is the one name the model is shown and everything the run
  // records resolves by.
  const agentIds = draft.agents.map((a) => a.id);
  if (new Set(agentIds).size !== agentIds.length) {
    return "Two agent profiles carry the same internal id, so a reference to either would name both.";
  }
  const slugs = draft.agents.map((a) => a.slug);
  if (new Set(slugs).size !== slugs.length) {
    return "Two agent profiles carry the same slug, so the model would be shown one name for two profiles — rename one of them, or override the imported profile's slug.";
  }
  const malformed = draft.agents.find((a) => !isValidAgentSlug(a.slug));
  if (malformed) {
    return `The \`${malformed.name.trim()}\` agent's slug must be lowercase letters and digits in groups separated by single hyphens — the model is shown this name and passes it back.`;
  }

  const slotError = slotMappingError(draft);
  if (slotError) return slotError;

  for (const agent of draft.agents) {
    // A machine is asked for no model: it takes no turns, so there is nothing for one to
    // do, and the profiles its states run are checked as the workers they are, on their
    // own passes through this loop.
    if (!isFsmShell(agent)) {
      if (agent.modelSource === "model-slot") {
        const slot = agent.modelSlots.find((s) => s.id === agent.modelSlotId);
        if (!slot) {
          return `The \`${agent.name.trim()}\` agent defers to a model slot it doesn't declare — pick one of its slots, or pin the agent a model.`;
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
    const hook = hookErrors(agent.hooks);
    if (hook)
      return `${hook.replace(/\.$/, "")} (on the \`${agent.name.trim()}\` agent).`;
    const failed = Object.entries(agentParamErrors(agent, draft.agents)).find(
      ([, error]) => error !== null,
    );
    if (failed) {
      // The value's own sentence, not "fix the params": gg names every value it cannot
      // honour and so does this, because "which one?" is the whole of what an operator
      // needs to know to fix it.
      const cap = capabilitySpec(failed[0]);
      return `${failed[1]!.replace(/\.$/, "")} — the \`${agent.name.trim()}\` agent's ${cap?.name ?? failed[0]} capability.`;
    }
  }

  const hooks = hookErrors(draft.hooks);
  if (hooks) return hooks;
  return runLimitsError(draft.limits);
}

// --- Draft -> capability set ----------------------------------------------------

/**
 * Serialize one agent draft into the wire [`GgAgentConfig`]. Every reference it holds to
 * another profile is already that profile's [id](GgAgentDraft.id) — the contract carries the
 * same id — so only the model binding is resolved, by `slotName`, the wire format naming its
 * slots. A slot id `slotName` cannot resolve is written through verbatim: it is a stored
 * value the editor could not match to a declaration, and dropping it would lose more than it
 * fixed.
 */
function agentConfigFromDraft(agent: GgAgentDraft): GgAgentConfig {
  const referenced = referencedModelSlots(agent);
  const slotNameById = new Map(
    agent.modelSlots.map((slot) => [slot.id, slot.name.trim()] as const),
  );
  const slotName = (slotId: string) => slotNameById.get(slotId) ?? slotId;
  // Only the slots this agent actually defers to are written: a declaration nothing binds
  // would become a launch input supplying no model to anything.
  const modelSlots: GgModelSlot[] = agent.modelSlots
    .filter((slot) => referenced.has(slot.id))
    .map((slot) => ({
      name: slot.name.trim(),
      ...(slot.defaultModelId.trim()
        ? { defaultModelId: slot.defaultModelId.trim() }
        : {}),
      ...(slot.passthrough ? { passthrough: true } : {}),
    }));
  const capabilities: GgCapabilityConfig[] = CAPABILITIES.map((cap) => {
    // Only the selected [type](GgAgentMode)'s configuration is recorded. What the draft
    // still holds for the other types is a convenience of the editing session — switching
    // type and back must not lose an edit — and writing it down would be a claim about
    // the run that is not true: gg never reads it.
    if (!capabilityAppliesToMode(cap, agent.mode)) {
      return { id: cap.id, enabled: false, params: {} };
    }
    const capDraft = agent.capabilities[cap.id] ?? capabilityDraftFor(cap.id);
    // A mode marker has no switch of its own: reaching here at all means the agent's type
    // *is* this one, which is what the flag records — and what makes its params required.
    const enabled = isModeCapability(cap.id) || Boolean(capDraft.enabled);
    const parsed = capabilityParams(cap, capDraft, enabled, slotName);
    const impl = (capDraft.implementation ?? "").trim();
    return {
      id: cap.id,
      enabled,
      // The arm as the picker holds it. Every arm this editor can select is written, so an
      // enabled capability that offers arms names one; the single empty value in the
      // catalog is autoload specifications' unlocked arm, which gg spells as the absent
      // key and which is therefore written by leaving it out.
      ...(impl ? { implementation: impl } : {}),
      // Record the config even for a disabled capability, so the on and off arms of two
      // configurations being compared stay symmetric.
      params: parsed.ok ? parsed.value : {},
    };
  });
  // A machine is not a worker: it takes no turns, so it runs no model, renders no prompt
  // and spawns from no roster — each state runs the profile it names, with that profile's
  // configuration. None of that is written, for the same reason another type's
  // capabilities are not: a recorded run must not claim a binding gg never read. The
  // empty `modelId` is the contract's own spelling of "no model bound".
  if (isFsmShell(agent)) {
    return {
      id: agent.id,
      slug: agent.slug.trim(),
      name: agent.name.trim(),
      capabilities,
      modelId: "",
    };
  }
  // An entry with no scopes is dropped: the editor removes a roster row by clearing its
  // last scope, so "listed but usable for nothing" is never a state to save.
  const subagents: GgSubagentRef[] = agent.subagents
    .filter((s) => s.scopes.length)
    .map((s) => ({
      agentId: s.agentId,
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
    id: agent.id,
    slug: agent.slug.trim(),
    name: agent.name.trim(),
    capabilities,
    modelId: agent.modelSource === "model" ? agent.modelId.trim() : "",
    ...(agent.modelSource === "model-slot"
      ? { modelSlot: slotName(agent.modelSlotId) }
      : {}),
    ...(modelSlots.length ? { modelSlots } : {}),
    // The allowlist, in the one vocabulary this agent's type is conducted in. The other
    // half of the draft is the editing session's scratch — the same convenience the other
    // types' capability drafts are — and recording it would claim a surface gg never
    // offered this agent.
    // An empty list is left out rather than written, because absent and empty are the same
    // grant — nothing — and the shorter of two spellings of nothing is the one a
    // round-trip should settle on.
    ...(agent.mode === "rac"
      ? agent.operations.length
        ? { operations: [...agent.operations] }
        : {}
      : agent.tools.length
        ? { tools: [...agent.tools] }
        : {}),
    ...(custom ? { customInstructions: custom } : {}),
    ...(template.trim() ? { systemPromptTemplate: template } : {}),
    // The standard lifetime is the default, so an agent left on it writes no key — which is
    // what keeps a configuration that never touched the knob byte-identical after a
    // round-trip.
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
 * The agents are written root-first, which is how the draft's root *flag* becomes the
 * contract's "the root is `agents[0]`".
 */
export function capabilitySetFromDraft(
  draft: GgConfigDraft,
  preset: string | null,
): GgCapabilitySet {
  const slotNameOn = (agentId: string, slotId: string): string | null =>
    draft.agents
      .find((a) => a.id === agentId)
      ?.modelSlots.find((slot) => slot.id === slotId)
      ?.name.trim() ?? null;
  const modelSlots: GgConfigSlot[] = draft.modelSlots.map((s) => ({
    name: s.name.trim(),
    ...(s.defaultModelId.trim()
      ? { defaultModelId: s.defaultModelId.trim() }
      : {}),
    targets: s.targets.flatMap((t) => {
      const slot = slotNameOn(t.agentId, t.slotId);
      return slot ? [{ agent: t.agentId, slot }] : [];
    }),
  }));
  const limits = runLimitsFromDraft(draft.limits);
  // The run's half only — the two session events. Symmetric with the filter in
  // [agentConfigFromDraft]: between them, every hook lands in exactly one of the two
  // lists, whichever list the editor happened to hold it in.
  const hooks = hooksFromDraft(
    draft.hooks.filter((hook) => hookScopeOf(hook.event) === "session"),
  );
  return {
    ...(preset ? { preset } : {}),
    agents: agentsInWireOrder(draft).map(agentConfigFromDraft),
    ...(modelSlots.length ? { modelSlots } : {}),
    ...(limits ? { limits } : {}),
    ...(hooks.length ? { hooks } : {}),
  };
}

/**
 * One agent draft as the wire contract carries it, with the rest of the configuration
 * supplying the model-slot names its bindings resolve to.
 *
 * This is the form a [saved agent](GgAgentSourceDraft) is stored in, and the form an
 * imported profile is compared against its saved agent in. `null` when the draft holds
 * no agent under that id.
 */
export function wireAgentFromDraft(
  draft: GgConfigDraft,
  agentId: string,
): GgAgentConfig | null {
  const agent = draft.agents.find((a) => a.id === agentId);
  return agent ? agentConfigFromDraft(agent) : null;
}

/**
 * The [model slot](GgModelSlot) names one stored agent's bindings defer to: its own
 * binding, plus every [`model` param](MODEL_PARAMS) that named a slot instead of pinning a
 * model.
 */
export function agentDeferredSlotNames(agent: GgAgentConfig): Set<string> {
  const out = new Set<string>();
  const own = agent.modelSlot?.trim();
  if (own) out.add(own);
  for (const { capId, slotKey } of MODEL_PARAMS) {
    const value = agent.capabilities?.find((c) => c.id === capId)?.params?.[
      slotKey
    ];
    const name = typeof value === "string" ? value.trim() : "";
    if (name) out.add(name);
  }
  return out;
}

/**
 * The launch-form name a passthrough agent slot is exposed under.
 *
 * Named after the profile's **slug** rather than its internal id, because this is a label an
 * operator reads on the launch form and answers with a model. Slugs are unique in any
 * saveable configuration, so it still names exactly one agent slot.
 */
export function passthroughSlotName(slug: string, slot: string): string {
  return `${slug}.${slot}`;
}

/**
 * The one set of launch inputs a configuration asks for: every configuration slot in
 * declaration order, then every passthrough agent slot in agent order.
 *
 * This is what the New run page renders a model picker for, keyed by name. A binding the
 * configuration pinned itself was decided when the configuration was written and is never
 * asked about again.
 */
export function launchModelSlots(set: GgCapabilitySet): GgLaunchSlotView[] {
  // A configuration slot names its targets by the profile's internal id, which is what an
  // authored set carries and what the launch form is handed.
  const agentSlot = (agentId: string, slot: string): GgModelSlot | undefined =>
    (set.agents ?? [])
      .find((a) => a.id === agentId)
      ?.modelSlots?.find((s) => s.name === slot);
  const out: GgLaunchSlotView[] = [];
  const push = (slot: GgLaunchSlotView) => {
    if (!out.some((s) => s.name === slot.name)) out.push(slot);
  };
  for (const declaration of set.modelSlots ?? []) {
    const targets = declaration.targets ?? [];
    push({
      name: declaration.name,
      defaultModelId:
        declaration.defaultModelId ??
        targets
          .map((t) => agentSlot(t.agent, t.slot)?.defaultModelId)
          .find(Boolean),
      targets: targets.map((t) => ({ agent: t.agent, slot: t.slot })),
    });
  }
  for (const agent of set.agents ?? []) {
    for (const slot of agent.modelSlots ?? []) {
      if (!slot.passthrough) continue;
      push({
        // Labelled by the slug, because that is the name the operator wrote and reads on the
        // launch form; filled by the id, because that is what a target names.
        name: passthroughSlotName(agent.slug, slot.name),
        defaultModelId: slot.defaultModelId,
        targets: [{ agent: agent.id ?? agent.slug, slot: slot.name }],
      });
    }
  }
  return out;
}

/** One launch input as [launchModelSlots] reports it. */
export interface GgLaunchSlotView {
  name: string;
  defaultModelId?: string;
  targets: Array<{ agent: string; slot: string }>;
}

/**
 * The capability set to launch a run with: every deferred binding — an agent's own, and
 * every [`model` param](MODEL_PARAMS)'s — resolved to the model the launcher collected for
 * the [launch input](launchModelSlots) that fills its slot, and every declaration dropped.
 * What runs is a fully pinned set.
 *
 * A binding the configuration pinned itself is untouched.
 */
export function bindModelSlots(
  set: GgCapabilitySet,
  models: Record<string, string>,
): GgCapabilitySet {
  // Which launch input fills each agent slot, so every binding is resolved through the one
  // set of models the launcher collected.
  const modelFor = new Map<string, string>();
  for (const input of launchModelSlots(set)) {
    const model = (models[input.name] ?? "").trim();
    for (const target of input.targets) {
      modelFor.set(`${target.agent}\u0000${target.slot}`, model);
    }
  }
  const agents: GgAgentConfig[] = (set.agents ?? []).map((agent) => {
    const key = agent.id ?? agent.slug;
    const model = (slot: string) =>
      modelFor.get(`${key}\u0000${slot.trim()}`) ?? "";
    const capabilities = (agent.capabilities ?? []).map((capability) => {
      const specs = MODEL_PARAMS.filter((m) => m.capId === capability.id);
      if (!specs.length) return capability;
      const params = { ...(capability.params ?? {}) };
      let bound = false;
      for (const { key, slotKey } of specs) {
        const slot = params[slotKey];
        if (typeof slot !== "string" || !slot.trim()) continue;
        const bindTo = model(slot);
        delete params[slotKey];
        // An empty binding pins nothing: the param goes back to being unset, which is
        // the arm gg already documents (condense on the agent's own model) rather than
        // a model id of "".
        if (bindTo) params[key] = bindTo;
        else delete params[key];
        bound = true;
      }
      return bound ? { ...capability, params } : capability;
    });
    const next = agent.capabilities ? { ...agent, capabilities } : agent;
    // Both the binding's deferral and the agent's own declarations go: what a run records
    // is a pinned model and no slot at either level.
    const { modelSlot, modelSlots: _declarations, ...rest } = next;
    return modelSlot ? { ...rest, modelId: model(modelSlot) } : rest;
  });
  const { modelSlots: _declarations, ...rest } = set;
  return { ...rest, agents };
}
