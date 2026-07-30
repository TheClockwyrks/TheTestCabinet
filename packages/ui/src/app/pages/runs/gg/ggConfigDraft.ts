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
  GgModelSlot,
  GgRunLimits,
  GgSubagentRef,
  GgSubagentScope,
} from "@test-cabinet/run-record/gg";
import {
  ALL_CAP_IDS,
  CAPABILITIES,
  DEFAULT_CAP_IDS,
  FILESYSTEM_CAP_IDS,
  LEGACY_FILESYSTEM_CAP_ID,
  PRIMARY_SLOT,
  ROOT_AGENT,
  RUN_LIMIT_SPECS,
  type CapSpec,
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
export interface GgAgentDraft {
  // Editor-only identity, stable across every rename. Which profile is the **root** is
  // a flag on the configuration ([GgConfigDraft.rootAgentId]) holding this id, so no
  // part of the editor decides it by looking for a particular name.
  id: string;
  name: string;
  capabilities: Record<string, GgCapabilityDraft>;
  modelSource: GgAgentModelSource;
  // The [id](GgModelSlotDraft.id) of the model slot this agent defers to, or empty when
  // it defers to none (a pinned binding, or a slot that was deleted out from under it).
  modelSlotId: string;
  modelId: string;
  disabledTools: string[];
  customInstructions: string;
  systemPromptTemplate: string;
  subagents: GgSubagentDraft[];
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
}

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
    capabilities: draftsFor(enabledIds, paramDefaults),
    modelSource: "model-slot",
    modelSlotId,
    modelId: "",
    disabledTools: [],
    customInstructions: "",
    systemPromptTemplate: "",
    subagents: [],
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

// --- Built-in configurations ----------------------------------------------------
//
// Every operator starts with these, and they are read-only: a study is a sweep over
// configurations, so the built-ins cover the useful arms — "full" (everything on),
// "minimal" (the default set), "no-compaction" (full minus the compaction backstop),
// and "shell-only" (an ablation extreme). None pins a model; the new-run form binds
// the `primary` model slot per run.

const FULL_PARAM_DEFAULTS: Record<string, Record<string, string>> = {
  subagents: { maxParallel: "4", maxDepth: "3" },
};

/** A built-in configuration: a name, a one-line purpose, and its draft. */
export interface BuiltInGgConfig {
  name: string;
  description: string;
  draft: GgConfigDraft;
}

function builtIn(
  name: string,
  description: string,
  enabledIds: ReadonlyArray<string>,
  paramDefaults: Record<string, Record<string, string>> = {},
): BuiltInGgConfig {
  return {
    name,
    description,
    // A built-in is a single root agent bound to a single `primary` slot — the starting
    // point an operator duplicates and then grows extra agents onto.
    //
    // Every built-in seeds gg's own default ceilings (the two error ones; turns
    // unbounded, runtime and cost off) and nothing more: the runtime and cost ceilings
    // are the arms of an ablation, and a shared read-only configuration that quietly
    // capped them would change what every study measured without saying so.
    draft: singleAgentDraft(
      blankAgentDraft(ROOT_AGENT, enabledIds, paramDefaults),
    ),
  };
}

/**
 * A whole draft around one agent: it is the root, it defers to a freshly declared
 * `primary` model slot, and any `agent` param it carries points at it.
 */
function singleAgentDraft(agent: GgAgentDraft): GgConfigDraft {
  const slot = blankPrimaryModelSlot();
  const root = seedAgentParams(
    { ...agent, modelSource: "model-slot", modelSlotId: slot.id },
    agent.id,
  );
  return {
    agents: [root],
    rootAgentId: root.id,
    modelSlots: [slot],
    limits: seededRunLimits(),
  };
}

/** The read-only configurations shared by every operator, in offer order. */
export const BUILT_IN_GG_CONFIGS: ReadonlyArray<BuiltInGgConfig> = [
  builtIn(
    "minimal",
    "The default capability set — the launchable baseline.",
    DEFAULT_CAP_IDS,
  ),
  builtIn(
    "full",
    "Every capability on, with the standard subagent params.",
    ALL_CAP_IDS,
    FULL_PARAM_DEFAULTS,
  ),
  builtIn(
    "no-compaction",
    "Everything on except the compaction backstop — the context-overflow arm.",
    ALL_CAP_IDS.filter((id) => id !== "compaction"),
    FULL_PARAM_DEFAULTS,
  ),
  builtIn("shell-only", "Shell and nothing else — the ablation extreme.", [
    "shell",
  ]),
];

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
  };
}

/**
 * A deep copy of a draft, so applying a built-in never aliases its constant. Local ids
 * are copied as they are: a duplicate is the same configuration in a new editing
 * session, and the two are never live at once.
 */
export function cloneDraft(draft: GgConfigDraft): GgConfigDraft {
  return {
    agents: draft.agents.map(cloneAgentDraft),
    rootAgentId: draft.rootAgentId,
    modelSlots: draft.modelSlots.map((s) => ({ ...s })),
    limits: { ...draft.limits },
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
// A `toggles` param is a JSON object of independently switchable members that are
// **on unless switched off**. The draft holds only the switched-off member ids,
// comma-separated, so it stays a plain string like every other dedicated control.

const TOGGLE_SEPARATOR = ",";

/** The switched-off member ids a `toggles` draft value stands for, in catalog order. */
export function togglesOff(
  spec: ParamSpec,
  raw: string | undefined,
): ReadonlyArray<string> {
  const off = new Set(
    (raw ?? "")
      .split(TOGGLE_SEPARATOR)
      .map((id) => id.trim())
      .filter(Boolean),
  );
  return (spec.options ?? []).map((o) => o.value).filter((id) => off.has(id));
}

/** The draft value for a `toggles` param with exactly `off` switched off. */
export function togglesDraftValue(
  spec: ParamSpec,
  off: ReadonlyArray<string>,
): string {
  return togglesOff(spec, off.join(TOGGLE_SEPARATOR)).join(TOGGLE_SEPARATOR);
}

/**
 * The draft value a *stored* `toggles` param decodes to, or `null` when the stored
 * value is not one this control can represent.
 */
function togglesFromParam(spec: ParamSpec, value: unknown): string | null {
  const ids = (spec.options ?? []).map((o) => o.value);
  if (value === false) return ids.join(TOGGLE_SEPARATOR);
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
  return togglesDraftValue(
    spec,
    entries.filter(([, on]) => on === false).map(([id]) => id),
  );
}

/**
 * The JSON a `toggles` draft value writes, or `undefined` for an all-on set (which
 * writes no param). Only the switched-off members are recorded.
 */
function togglesToParam(
  spec: ParamSpec,
  raw: string,
): Record<string, boolean> | undefined {
  const off = togglesOff(spec, raw);
  if (off.length === 0) return undefined;
  return Object.fromEntries(off.map((id) => [id, false]));
}

// --- `commands` params ----------------------------------------------------------
//
// A `commands` param is an ordered list of shell commands, each with a required command
// line and an optional working directory and timeout — the shape gg's completion
// validation gate takes. The draft holds the list as JSON *text*, so it is a plain string
// like every other dedicated control while still carrying structure the form lays out as
// rows, and a half-typed row survives a re-render.

/** One row of a `commands` param as the editor holds it. */
export interface CommandDraft {
  command: string;
  cwd: string;
  /** Seconds, as typed — empty means gg's own per-command default. */
  timeoutSecs: string;
}

/** A blank row, appended by the editor's "+ Add command". */
export function blankCommandDraft(): CommandDraft {
  return { command: "", cwd: "", timeoutSecs: "" };
}

/**
 * The rows a `commands` draft value stands for. A value that is not the JSON list this
 * control writes yields no rows rather than throwing — the draft is text an operator (or
 * a stored config) can put anything in, and a form that crashed on it would be worse than
 * one that shows an empty list.
 */
export function commandsFromDraft(
  raw: string | undefined,
): ReadonlyArray<CommandDraft> {
  if (!raw?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map((entry) => ({
    command: String((entry as CommandDraft)?.command ?? ""),
    cwd: String((entry as CommandDraft)?.cwd ?? ""),
    timeoutSecs: String((entry as CommandDraft)?.timeoutSecs ?? ""),
  }));
}

/** The draft value holding exactly `rows` — the inverse of [commandsFromDraft]. */
export function commandsDraftValue(rows: ReadonlyArray<CommandDraft>): string {
  return rows.length ? JSON.stringify(rows) : "";
}

/**
 * The draft value a *stored* `commands` param decodes to, or `null` when the stored value
 * is not one this control can represent (which routes it to the verbatim passthrough).
 *
 * gg accepts a bare string as shorthand for a command with no cwd or timeout, so both
 * spellings load into rows.
 */
function commandsFromParam(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const rows: CommandDraft[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      rows.push({ ...blankCommandDraft(), command: entry });
      continue;
    }
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return null;
    }
    const { command, cwd, timeoutSecs, ...rest } = entry as Record<
      string,
      unknown
    >;
    // An entry carrying a key this control does not know is one a round-trip through the
    // rows would silently drop, so the whole param goes to the passthrough instead.
    if (Object.keys(rest).length) return null;
    if (typeof command !== "string") return null;
    if (cwd !== undefined && typeof cwd !== "string") return null;
    if (timeoutSecs !== undefined && typeof timeoutSecs !== "number") {
      return null;
    }
    rows.push({
      command,
      cwd: cwd ?? "",
      timeoutSecs: timeoutSecs === undefined ? "" : String(timeoutSecs),
    });
  }
  return commandsDraftValue(rows);
}

/**
 * The JSON a `commands` draft value writes, or `undefined` when it names no usable
 * command (which writes no param at all — the ungated arm). A row with a blank command is
 * dropped: it is a row the operator started and did not fill in, not an instruction to
 * run nothing.
 */
function commandsToParam(
  raw: string,
): Array<Record<string, unknown>> | undefined {
  const rows = commandsFromDraft(raw)
    .map((row) => ({
      command: row.command.trim(),
      cwd: row.cwd.trim(),
      timeout: Number(row.timeoutSecs.trim()),
      hasTimeout: Boolean(row.timeoutSecs.trim()),
    }))
    .filter((row) => row.command);
  if (!rows.length) return undefined;
  return rows.map((row) => ({
    command: row.command,
    ...(row.cwd ? { cwd: row.cwd } : {}),
    ...(row.hasTimeout && Number.isFinite(row.timeout) && row.timeout > 0
      ? { timeoutSecs: row.timeout }
      : {}),
  }));
}

// --- Agent config <-> draft -----------------------------------------------------

/**
 * Fill an agent draft from a stored agent config, so every catalog capability has a
 * row even if the config predates it (or omits it, which means off). A config saved
 * before the `filesystem` capability was split names only the umbrella; it is expanded
 * into the four per-tool capabilities here, matching how gg reads it.
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
  const legacyFilesystem = stored.get(LEGACY_FILESYSTEM_CAP_ID);
  if (legacyFilesystem) {
    for (const id of FILESYSTEM_CAP_IDS) {
      if (!stored.has(id)) {
        stored.set(id, { id, enabled: legacyFilesystem.enabled, params: {} });
      }
    }
  }
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
    const params: Record<string, string> = {};
    const extraParams: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(from.params ?? {})) {
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
      if (spec.kind === "commands") {
        const decoded = commandsFromParam(value);
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
  return {
    id: localId("agent"),
    name: agent.name,
    capabilities,
    modelSource: agent.modelSlot ? "model-slot" : "model",
    modelSlotId: slotIdByName.get(agent.modelSlot?.trim() ?? "") ?? "",
    modelId: agent.modelId ?? "",
    disabledTools: [...(agent.disabledTools ?? [])],
    customInstructions: agent.customInstructions ?? "",
    systemPromptTemplate: agent.systemPromptTemplate ?? "",
    // Filled in by [resolveAgentReferences], which needs every profile's id.
    subagents: [],
  };
}

/**
 * Resolve one agent's *name*-keyed cross-references — its roster and its `agent` params
 * — onto the local ids the draft works in.
 *
 * A roster entry naming a profile the set does not declare is dropped: gg refuses such a
 * set at launch, and the draft has no id to point it at, so carrying it would only be a
 * broken reference the editor could not show. An `agent` param that names no declared
 * profile *is* kept verbatim, because it round-trips as itself and the form flags it as
 * missing rather than silently repointing it.
 */
function resolveAgentReferences(
  draft: GgAgentDraft,
  stored: GgAgentConfig,
  idByName: ReadonlyMap<string, string>,
): GgAgentDraft {
  const capabilities = { ...draft.capabilities };
  for (const cap of CAPABILITIES) {
    const agentParams = (cap.params ?? []).filter((p) => p.kind === "agent");
    if (!agentParams.length) continue;
    const capDraft = capabilities[cap.id];
    if (!capDraft?.params) continue;
    const params = { ...capDraft.params };
    for (const p of agentParams) {
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
  // An agent may name a slot the set never declared; declare it here so the binding has
  // something real to point at rather than opening as an unexplained blank.
  for (const agent of stored) {
    const name = agent.modelSlot?.trim();
    if (name && !modelSlots.some((m) => m.name === name)) {
      modelSlots.push({ id: localId("slot"), name, defaultModelId: "" });
    }
  }
  const slotIdByName = new Map(modelSlots.map((s) => [s.name, s.id] as const));
  const agents = stored.map((agent) =>
    agentDraftFromConfig(agent, slotIdByName),
  );
  const idByName = new Map(
    stored.map((agent, i) => [agent.name, agents[i]!.id] as const),
  );
  return {
    agents: agents.map((agent, i) =>
      resolveAgentReferences(agent, stored[i]!, idByName),
    ),
    rootAgentId: agents[0]!.id,
    modelSlots,
    limits: runLimitsDraft(set.limits),
  };
}

/**
 * A stored ceiling set as the form's six text fields. An absent ceiling stays the
 * empty string — the form's own spelling of "off".
 */
function runLimitsDraft(limits: GgRunLimits | undefined): GgRunLimitsDraft {
  const draft = blankRunLimits();
  for (const spec of RUN_LIMIT_SPECS) {
    const value = limits?.[spec.key];
    if (value !== undefined) draft[spec.key] = String(value);
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
): ParamsParse {
  const out: Record<string, unknown> = { ...(draft.extraParams ?? {}) };
  for (const p of cap.params ?? []) {
    const raw = (draft.params?.[p.key] ?? "").trim();
    if (!raw) continue;
    if (p.kind === "agent") {
      out[p.key] = agentName ? agentName(raw) : raw;
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
    if (p.kind === "commands") {
      const commands = commandsToParam(raw);
      if (commands) out[p.key] = commands;
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
 * A draft's ceilings as the wire shape, or `undefined` when it declares none.
 */
export function runLimitsFromDraft(
  limits: GgRunLimitsDraft,
): GgRunLimits | undefined {
  const out: GgRunLimits = {};
  for (const spec of RUN_LIMIT_SPECS) {
    const raw = limits[spec.key].trim();
    if (!raw) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) out[spec.key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** One agent's per-capability param errors, keyed by capability id (`null` = ok). */
export function agentParamErrors(
  agent: GgAgentDraft,
): Record<string, string | null> {
  const errors: Record<string, string | null> = {};
  for (const cap of CAPABILITIES) {
    const capDraft = agent.capabilities[cap.id];
    if (!capDraft?.enabled) {
      errors[cap.id] = null;
      continue;
    }
    const parsed = capabilityParams(cap, capDraft);
    errors[cap.id] = parsed.ok ? null : parsed.error;
  }
  return errors;
}

/**
 * The [ids](GgModelSlotDraft.id) of the model slots at least one agent actually defers
 * to. A declared-but-unreferenced slot feeds nothing, so it is never asked about at
 * launch (and the editor flags it).
 */
export function referencedModelSlots(draft: GgConfigDraft): Set<string> {
  return new Set(
    draft.agents
      .filter((a) => a.modelSource === "model-slot")
      .map((a) => a.modelSlotId)
      .filter(Boolean),
  );
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
  return (
    Boolean(agent.capabilities[PROJECT_MANAGEMENT_CAP_ID]?.enabled) &&
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
  const failed = Object.entries(agentParamErrors(agent)).find(
    ([, error]) => error !== null,
  );
  return failed ? failed[1] : null;
}

/**
 * Why a draft cannot be saved, or `null` when it is well-formed. A *saved*
 * configuration may still be waiting on its models — that is what a model slot is for
 * — so this rejects only an agent-less configuration, structurally broken names, an
 * agent deferred to a model slot that was never declared, a pinned agent with no model,
 * an issue filer with nobody to assign issues to, and unparseable params.
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
    if (agent.modelSource === "model-slot") {
      const slot = draft.modelSlots.find((s) => s.id === agent.modelSlotId);
      if (!slot) {
        return `The \`${agent.name.trim()}\` agent defers to a model slot this configuration doesn't declare — pick one of its slots, or pin the agent a model.`;
      }
    } else if (!agent.modelId.trim()) {
      return `The \`${agent.name.trim()}\` agent pins no model — choose one, or bind it to a model slot.`;
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
    const failed = Object.entries(agentParamErrors(agent)).find(
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
    const capDraft = agent.capabilities[cap.id] ?? blankCapabilityDraft();
    const parsed = capabilityParams(cap, capDraft, agentName);
    const impl = (capDraft.implementation ?? "").trim();
    return {
      id: cap.id,
      enabled: Boolean(capDraft.enabled),
      ...(impl ? { implementation: impl } : {}),
      // Record the config even for a disabled capability, so an ablation's on/off arms
      // stay symmetric.
      params: parsed.ok ? parsed.value : {},
    };
  });
  const subagents: GgSubagentRef[] = agent.subagents
    .filter((s) => agentName(s.agentId) && s.scopes.length)
    .map((s) => ({
      agent: agentName(s.agentId),
      description: s.description,
      scopes: [...s.scopes],
    }));
  const custom = agent.customInstructions.trim();
  const template = agent.systemPromptTemplate;
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
    ...(subagents.length ? { subagents } : {}),
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
  return {
    ...(preset ? { preset } : {}),
    agents: agentsInWireOrder(draft).map((agent) =>
      agentConfigFromDraft(agent, agentName, slotName),
    ),
    ...(modelSlots.length ? { modelSlots } : {}),
    ...(limits ? { limits } : {}),
  };
}

/**
 * The launch inputs a configuration is still waiting on: the model slots it declares
 * that at least one agent defers to, in declaration order.
 *
 * This is what the New run page asks for, and it is deliberately *only* this — an
 * agent the configuration pinned to a model outright was decided when the
 * configuration was written and is never asked about again.
 */
export function launchModelSlots(set: GgCapabilitySet): GgModelSlot[] {
  const declared = set.modelSlots ?? [];
  const agents = set.agents ?? [];
  const deferred = new Set(
    agents.map((a) => a.modelSlot).filter((s): s is string => Boolean(s)),
  );
  const out: GgModelSlot[] = [];
  const push = (slot: GgModelSlot) => {
    if (!out.some((s) => s.name === slot.name)) out.push(slot);
  };
  for (const declaration of declared) {
    if (deferred.has(declaration.name)) push(declaration);
  }
  // An agent that names a slot the set never declared still needs a model at launch.
  for (const name of deferred) {
    push({ name });
  }
  return out;
}

/**
 * The capability set to launch a run with: every [deferred](launchModelSlots) agent
 * binding resolved to the model the launcher collected for its slot (keyed by
 * model-slot name), and the declarations dropped — what runs is a fully pinned set.
 *
 * An agent the configuration pinned itself is untouched.
 */
export function bindModelSlots(
  set: GgCapabilitySet,
  models: Record<string, string>,
): GgCapabilitySet {
  const agents: GgAgentConfig[] = (set.agents ?? []).map((agent) => {
    if (!agent.modelSlot) return agent;
    const { modelSlot: _slot, ...rest } = agent;
    return {
      ...rest,
      modelId: (models[agent.modelSlot] ?? "").trim(),
    };
  });
  const { modelSlots: _declarations, ...rest } = set;
  return { ...rest, agents };
}
