// The editable form of a gg configuration, and the conversions between it and the
// wire `GgCapabilitySet`.
//
// A gg run is configured by a capability set, not by a harness/model/orchestrator
// tuple — so a *named capability set* is what an operator registers (the account
// section's gg tab, persisted per-account by the backend) and what the new-run form
// launches once `gg` is picked as the orchestrator. This module owns the draft
// shape that editor works in, the built-in configurations every operator starts
// with, and the (de)serialization so the editor and the launcher never drift on
// what a saved configuration means.
//
// The draft keeps param values — and the run's execution ceilings — as *typed text*
// rather than parsed JSON or numbers, so an in-progress, not-yet-valid edit survives
// a re-render (and a save round-trip) instead of being silently dropped, and so an
// empty ceiling field stays distinguishable from a ceiling deliberately set to zero.

import type {
  GgCapabilityConfig,
  GgCapabilitySet,
  GgModelSlot,
  GgRunLimits,
  GgSlotBinding,
} from "@test-cabinet/run-record/gg";
import {
  ALL_CAP_IDS,
  CAPABILITIES,
  DEFAULT_CAP_IDS,
  DEFAULT_MAX_TURNS,
  FILESYSTEM_CAP_IDS,
  LEGACY_FILESYSTEM_CAP_ID,
  PRIMARY_SLOT,
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
// *stored* configuration had that no dedicated control covers (a key from a newer
// client, a legacy one, or a value a control can't represent), so reopening and
// re-saving a configuration never silently drops a param gg might still read. Every
// param gg actually reads has a control, so a configuration authored here leaves it
// empty — it exists only to keep a round-trip lossless, which is why the editor
// carries no raw-JSON field.
export interface GgCapabilityDraft {
  enabled: boolean;
  implementation?: string;
  params?: Record<string, string>;
  extraParams?: Record<string, unknown>;
}

// One declared **model slot** as the editor holds it: a launch-time model parameter
// with an optional default the new-run form pre-fills. Declaring these is what makes
// one saved configuration reusable across models — the operator supplies the models at
// launch instead of the configuration baking them in.
export interface GgModelSlotDraft {
  name: string;
  defaultModelId: string;
}

// Where a role binding gets its model: from a declared model slot (supplied at
// launch) or pinned here, in the configuration, for every run of it.
export type GgSlotSource = "model-slot" | "model";

// One role binding as the editor holds it. The role (`slot` — "primary",
// "reviewer", …) is what capabilities reference; `source` decides where its model
// comes from. A `model-slot` binding names a declared [GgModelSlotDraft] and is
// filled in at launch; a `model` binding pins a model id and is never asked about
// again.
export interface GgSlotDraft {
  slot: string;
  source: GgSlotSource;
  modelSlot: string;
  modelId: string;
}

// The run's execution ceilings as the editor holds them: one *string* per ceiling,
// keyed by its wire field, so the form can hold "empty" (the ceiling is off, or —
// for the turn ceiling — left to gg's default) distinctly from `0`, which for two
// of the six is a value gg deliberately reads as "cannot bound anything".
//
// A total record over `keyof GgRunLimits` rather than a hand-listed interface: a
// ceiling added to the contract is then a compile error in every function below,
// which is the whole reason the console can be trusted to show what a run was
// actually bounded by.
export type GgRunLimitsDraft = Record<keyof GgRunLimits, string>;

// A whole gg configuration as the editor holds it, minus the test case/variant
// (those are per-run, never part of a reusable configuration): the per-capability
// drafts keyed by capability id, the declared model slots, the role bindings that
// consume them, the run's execution ceilings, and the per-tool ablation overrides.
export interface GgConfigDraft {
  capabilities: Record<string, GgCapabilityDraft>;
  modelSlots: GgModelSlotDraft[];
  slots: GgSlotDraft[];
  limits: GgRunLimitsDraft;
  disabledTools: string[];
}

/**
 * Every ceiling left empty — the true "nothing set" state. This is the base the
 * load path fills stored values onto, so a stored configuration that declared no
 * ceiling round-trips to one that still declares none. Fresh drafts use
 * {@link seededRunLimits} instead, which seeds gg's documented defaults.
 */
export function blankRunLimits(): GgRunLimitsDraft {
  return {
    maxTurns: "",
    maxRuntimeSecs: "",
    maxConsecutiveErrors: "",
    maxErrorRate: "",
    errorRateWindow: "",
    maxCost: "",
  };
}

/**
 * A fresh configuration's ceilings, with every ceiling that has a documented default
 * (only the turn ceiling) seeded to it, so a new configuration shows gg's real
 * default rather than an empty box. Clearing a seeded field is exactly leaving the
 * ceiling empty.
 */
export function seededRunLimits(): GgRunLimitsDraft {
  const draft = blankRunLimits();
  for (const spec of RUN_LIMIT_SPECS) {
    if (spec.defaultValue !== undefined) draft[spec.key] = spec.defaultValue;
  }
  return draft;
}

/** A capability's dedicated param controls seeded to their documented defaults. */
function seededParams(cap: CapSpec): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of cap.params ?? []) {
    if (p.defaultValue !== undefined) out[p.key] = p.defaultValue;
  }
  return out;
}

/** A capability row that is off, unconfigured, and carries no params. */
export function blankCapabilityDraft(): GgCapabilityDraft {
  return { enabled: false, implementation: "", params: {}, extraParams: {} };
}

/**
 * The primary role, deferred to a model slot of the same name — the starting point of
 * a fresh draft, and the shape a configuration saved before model slots existed
 * migrates to. It is what makes the common case work with no setup: declare nothing,
 * and the New run page still asks for one model.
 */
export function blankPrimarySlot(): GgSlotDraft {
  return {
    slot: PRIMARY_SLOT,
    source: "model-slot",
    modelSlot: PRIMARY_SLOT,
    modelId: "",
  };
}

/** The matching `primary` model-slot declaration, with no default. */
export function blankPrimaryModelSlot(): GgModelSlotDraft {
  return { name: PRIMARY_SLOT, defaultModelId: "" };
}

/** A blank role binding pinned to no model — a freshly added row. */
export function blankSlot(): GgSlotDraft {
  return {
    slot: "",
    source: "model-slot",
    modelSlot: PRIMARY_SLOT,
    modelId: "",
  };
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

// --- Built-in configurations ----------------------------------------------------
//
// Every operator starts with these, and they are read-only: a study is a sweep over
// configurations, so the built-ins cover the useful arms — "full" (everything on),
// "minimal" (the default set), "no-compaction" (full minus the compaction
// backstop), and "shell-only" (an ablation extreme). None pins a model; the
// new-run form binds the primary slot per run.

const FULL_PARAM_DEFAULTS: Record<string, Record<string, string>> = {
  compaction: { triggerFullness: "0.85" },
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
    draft: {
      capabilities: draftsFor(enabledIds, paramDefaults),
      modelSlots: [blankPrimaryModelSlot()],
      slots: [blankPrimarySlot()],
      // No built-in arms a ceiling beyond gg's own default turn ceiling: the others
      // are the arms of an ablation, and a shared read-only configuration that
      // quietly capped cost or errors would change what every study measured without
      // saying so. The turn ceiling is seeded to its default (50), which is what gg
      // does anyway, so it documents the default without changing any measurement.
      limits: seededRunLimits(),
      disabledTools: [],
    },
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
    "Every capability on, with the standard compaction and subagent params.",
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

/** A deep copy of a draft, so applying a built-in never aliases its constant. */
export function cloneDraft(draft: GgConfigDraft): GgConfigDraft {
  return {
    capabilities: Object.fromEntries(
      Object.entries(draft.capabilities).map(([id, cap]) => [
        id,
        {
          ...cap,
          params: { ...(cap.params ?? {}) },
          extraParams: { ...(cap.extraParams ?? {}) },
        },
      ]),
    ),
    modelSlots: draft.modelSlots.map((s) => ({ ...s })),
    slots: draft.slots.map((s) => ({ ...s })),
    limits: { ...draft.limits },
    disabledTools: [...draft.disabledTools],
  };
}

/**
 * A blank draft: every catalog capability present and off, one declared `primary`
 * model slot, and the primary role deferred to it.
 */
export function emptyDraft(): GgConfigDraft {
  return {
    capabilities: draftsFor([]),
    modelSlots: [blankPrimaryModelSlot()],
    slots: [blankPrimarySlot()],
    limits: seededRunLimits(),
    disabledTools: [],
  };
}

// --- `toggles` params -----------------------------------------------------------
//
// A `toggles` param is a JSON object of independently switchable members that are
// **on unless switched off** — gg's response-healing strategies are the shape it
// exists for. The draft holds only the switched-off member ids, comma-separated, so
// it stays a plain string like every other dedicated control, and an all-on set is
// the empty string, which writes no param at all and so leaves the run on whatever
// the default arm turns out to be.

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
 *
 * Returning `null` rather than guessing is what keeps a round trip honest: an
 * unreadable value (a typo'd member id, a number where a boolean belongs, the
 * master `false` spelled as `"off"`) is preserved verbatim in the capability's
 * `extraParams` passthrough, so reopening a configuration never silently rewrites a
 * param gg itself would report as unknown.
 *
 * The two shapes that *are* representable and mean "everything on" — `true` and
 * `{}` — decode to the empty draft, and are therefore written back as no param at
 * all. That is the same configuration by a shorter name, which is the one
 * normalisation this function does on purpose.
 */
function togglesFromParam(spec: ParamSpec, value: unknown): string | null {
  const ids = (spec.options ?? []).map((o) => o.value);
  // The master switch: everything off.
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
 * writes no param). Only the switched-off members are recorded — see the catalog's
 * `TOGGLES_HINT` for why an untouched member must stay absent rather than being
 * pinned to `true`.
 */
function togglesToParam(
  spec: ParamSpec,
  raw: string,
): Record<string, boolean> | undefined {
  const off = togglesOff(spec, raw);
  if (off.length === 0) return undefined;
  return Object.fromEntries(off.map((id) => [id, false]));
}

// --- Capability set <-> draft ---------------------------------------------------

/**
 * Fill a draft from a stored capability set, so every catalog capability has a row
 * even if the set predates it (or omits it, which means off).
 *
 * A set saved before the `filesystem` capability was split into one capability per
 * tool names only the umbrella. It is expanded here rather than being read as four
 * capabilities that are all off: the operator opens the configuration they saved,
 * expressed the new way, and the umbrella row is not resurrected (an expanded
 * capability carries no implementation or params, which is exactly the behavior it
 * had). gg honors the same alias when it assembles a run's toolset, so a stored
 * configuration nobody has reopened keeps launching too.
 */
export function draftFromCapabilitySet(set: GgCapabilitySet): GgConfigDraft {
  const stored = new Map(
    (set.capabilities ?? []).map((cap) => [cap.id, cap] as const),
  );
  const legacyFilesystem = stored.get(LEGACY_FILESYSTEM_CAP_ID);
  if (legacyFilesystem) {
    for (const id of FILESYSTEM_CAP_IDS) {
      // An explicit per-tool row wins over the umbrella beside it.
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
        // A stored value this control cannot represent is preserved verbatim rather
        // than being coerced into checkboxes that would write back something else.
        const decoded = togglesFromParam(spec, value);
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
  const slots: GgSlotDraft[] = (set.slots ?? []).map((s) => ({
    slot: s.slot,
    source: s.modelSlot ? "model-slot" : "model",
    modelSlot: s.modelSlot ?? "",
    modelId: s.modelId,
  }));
  const modelSlots: GgModelSlotDraft[] = (set.modelSlots ?? []).map((s) => ({
    name: s.name,
    defaultModelId: s.defaultModelId ?? "",
  }));
  // A configuration saved before model slots existed left the primary role unbound
  // and relied on the launch form to bind it. That is exactly a `primary` model slot,
  // so migrate it to one rather than opening the editor on a binding that reads as
  // broken — the operator sees the same configuration, expressed the new way.
  if (!slots.some((s) => s.slot === PRIMARY_SLOT)) {
    slots.unshift(blankPrimarySlot());
  }
  for (const referenced of slots) {
    if (referenced.source !== "model-slot") continue;
    if (!modelSlots.some((m) => m.name === referenced.modelSlot)) {
      modelSlots.push({
        name: referenced.modelSlot,
        defaultModelId: "",
      });
    }
  }
  return {
    capabilities,
    modelSlots,
    slots,
    limits: runLimitsDraft(set.limits),
    disabledTools: [...(set.disabledTools ?? [])],
  };
}

/**
 * A stored ceiling set as the form's six text fields. An absent ceiling stays the
 * empty string — the form's own spelling of "off" — so reopening a configuration
 * that declared none and saving it again writes no `limits` key back.
 */
function runLimitsDraft(limits: GgRunLimits | undefined): GgRunLimitsDraft {
  const draft = blankRunLimits();
  for (const spec of RUN_LIMIT_SPECS) {
    const value = limits?.[spec.key];
    if (value !== undefined) draft[spec.key] = String(value);
  }
  return draft;
}

// The result of assembling a capability's params: the params object on success, or
// an error string the form surfaces inline when a dedicated control holds something
// its kind cannot accept.
type ParamsParse =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Validate + fold a capability's dedicated param controls over the params a stored
 * configuration carried that no control covers ([GgCapabilityDraft.extraParams]). A
 * dedicated control's value wins over a same-named passthrough key. Returns an error
 * string on the first invalid field (only meaningful when the capability is on).
 *
 * There is no JSON to parse: every param the editor writes comes from a typed
 * control, and the passthrough is already a parsed object, so a capability can no
 * longer be un-saveable because of malformed JSON — only because a numeric field
 * holds a non-number or an out-of-range fraction.
 */
export function capabilityParams(
  cap: CapSpec,
  draft: GgCapabilityDraft,
): ParamsParse {
  const out: Record<string, unknown> = { ...(draft.extraParams ?? {}) };
  for (const p of cap.params ?? []) {
    const raw = (draft.params?.[p.key] ?? "").trim();
    if (!raw) continue;
    if (p.kind === "select" || p.kind === "text") {
      out[p.key] = raw;
      continue;
    }
    if (p.kind === "toggles") {
      const toggles = togglesToParam(p, raw);
      if (toggles) out[p.key] = toggles;
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

/**
 * `disabledTools` with a whole bundle restored (`on`) or withheld (`!on`) — every
 * tool the bundle names is added or removed together, so a slider can never leave a
 * bundle half-withheld.
 */
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

/**
 * Whether a role binding resolves to something: a pinned model, or a named model
 * slot the launch will fill in.
 */
export function slotHasBinding(slot: GgSlotDraft): boolean {
  return slot.source === "model-slot"
    ? slot.modelSlot.trim().length > 0
    : slot.modelId.trim().length > 0;
}

// --- Run limits -----------------------------------------------------------------

/**
 * Why a draft's execution ceilings cannot be saved, or `null` when they are
 * well-formed.
 *
 * gg itself is deliberately forgiving here — a ceiling that cannot bound anything
 * resolves to "off" with a startup warning, never an error, so a sweep's shared
 * configuration document stays interpretable by every arm. The editor is stricter
 * on purpose: at authoring time there is somebody to tell, and a guardrail that
 * silently does nothing is the one kind of guardrail worth refusing to save.
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
  // Neither half of the rate ceiling means anything alone: a rate has nothing to be
  // measured over, and a window has no threshold to be judged against.
  const rate = limits.maxErrorRate.trim();
  const window = limits.errorRateWindow.trim();
  if (Boolean(rate) !== Boolean(window)) {
    return "An error-rate ceiling needs both a rate and a window — either one alone is no ceiling at all.";
  }
  return null;
}

/**
 * The one thing about a well-formed ceiling set worth saying out loud without
 * refusing the save: a rate window that is not smaller than the turn ceiling can
 * only ever fill on the last turn an agent is allowed, so the ceiling is armed but
 * can never stop a run before it is over anyway.
 */
export function runLimitsWarning(limits: GgRunLimitsDraft): string | null {
  const window = Number(limits.errorRateWindow.trim());
  if (!limits.errorRateWindow.trim() || !Number.isFinite(window)) return null;
  if (!limits.maxErrorRate.trim()) return null;
  const declared = Number(limits.maxTurns.trim());
  const turns =
    limits.maxTurns.trim() && Number.isFinite(declared)
      ? declared
      : DEFAULT_MAX_TURNS;
  if (window < turns) return null;
  return `The error-rate window (${window}) isn't smaller than the turn ceiling (${turns}), so the rate ceiling could only ever fire on the last turn an agent is allowed.`;
}

/**
 * A draft's ceilings as the wire shape, or `undefined` when it declares none — so a
 * form nobody touched round-trips to a capability set with no `limits` key at all,
 * and "this configuration sets no ceilings" and "this configuration sets every
 * ceiling to nothing" stay the same statement.
 *
 * A field that is present but unparseable is dropped rather than written as `NaN`;
 * [runLimitsError] has already refused to save such a draft, and the same tolerance
 * is what {@link capabilitySetFromDraft} extends to a capability's params.
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

/** The per-capability param errors of a draft, keyed by capability id (`null` = ok). */
export function draftParamErrors(
  draft: GgConfigDraft,
): Record<string, string | null> {
  const errors: Record<string, string | null> = {};
  for (const cap of CAPABILITIES) {
    const capDraft = draft.capabilities[cap.id];
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
 * Why a draft cannot be saved, or `null` when it is well-formed. A *saved*
 * configuration may still be waiting on its models — that is what a model slot is
 * for — so this rejects only structurally broken names, a role deferred to a model
 * slot that was never declared, and unparseable params.
 */
export function draftSaveError(draft: GgConfigDraft): string | null {
  const modelSlotNames = draft.modelSlots.map((s) => s.name.trim());
  if (modelSlotNames.some((n) => !n)) return "Every model slot needs a name.";
  if (new Set(modelSlotNames).size !== modelSlotNames.length)
    return "Model slot names must be unique.";
  const names = draft.slots.map((s) => s.slot.trim());
  if (names.some((n) => !n)) return "Every role binding needs a slot name.";
  if (new Set(names).size !== names.length)
    return "Role slot names must be unique.";
  const dangling = draft.slots.find(
    (s) =>
      s.source === "model-slot" && !modelSlotNames.includes(s.modelSlot.trim()),
  );
  if (dangling) {
    return `The \`${dangling.slot.trim()}\` role is bound to the \`${dangling.modelSlot.trim()}\` model slot, which isn't declared.`;
  }
  const failed = Object.entries(draftParamErrors(draft)).find(
    ([, error]) => error !== null,
  );
  if (failed) return `Fix the ${failed[0]} params before saving.`;
  return runLimitsError(draft.limits);
}

/**
 * The names of the model slots at least one role binding actually defers to. A
 * declared-but-unreferenced slot feeds nothing, so it is never asked about at launch
 * (and the editor flags it).
 */
export function referencedModelSlots(draft: GgConfigDraft): Set<string> {
  return new Set(
    draft.slots
      .filter((s) => s.source === "model-slot")
      .map((s) => s.modelSlot.trim())
      .filter(Boolean),
  );
}

/**
 * Serialize a draft into the wire capability set. `preset` records the name the set
 * was assembled from (a run's slice-by facet); pass `null` for a hand-assembled one.
 * A role that resolves to neither a model nor a model slot is dropped — a binding
 * with nothing behind it is not a binding.
 */
export function capabilitySetFromDraft(
  draft: GgConfigDraft,
  preset: string | null,
): GgCapabilitySet {
  const capabilities: GgCapabilityConfig[] = CAPABILITIES.map((cap) => {
    const capDraft = draft.capabilities[cap.id] ?? blankCapabilityDraft();
    const parsed = capabilityParams(cap, capDraft);
    const impl = capDraft.implementation?.trim();
    return {
      id: cap.id,
      enabled: Boolean(capDraft.enabled),
      ...(impl ? { implementation: impl } : {}),
      // Record the config even for a disabled capability, so an ablation's on/off
      // arms stay symmetric.
      params: parsed.ok ? parsed.value : {},
    };
  });
  const slots: GgSlotBinding[] = draft.slots
    .filter((s) => slotHasBinding(s))
    .map((s) => {
      if (s.source === "model-slot") {
        // Deferred: no model yet, just the slot the launch fills in.
        return {
          slot: s.slot.trim(),
          modelId: "",
          modelSlot: s.modelSlot.trim(),
        };
      }
      return {
        slot: s.slot.trim(),
        modelId: s.modelId.trim(),
      };
    });
  // Only the declarations something actually defers to are worth saving; a slot no
  // role consumes would otherwise resurface as a launch input that changes nothing.
  const referenced = referencedModelSlots(draft);
  const modelSlots: GgModelSlot[] = draft.modelSlots
    .filter((s) => referenced.has(s.name.trim()))
    .map((s) => ({
      name: s.name.trim(),
      ...(s.defaultModelId.trim()
        ? { defaultModelId: s.defaultModelId.trim() }
        : {}),
    }));
  const limits = runLimitsFromDraft(draft.limits);
  return {
    ...(preset ? { preset } : {}),
    capabilities,
    slots,
    ...(modelSlots.length ? { modelSlots } : {}),
    ...(limits ? { limits } : {}),
    ...(draft.disabledTools.length
      ? { disabledTools: draft.disabledTools }
      : {}),
  };
}

/**
 * The launch inputs a configuration is still waiting on: the model slots it declares
 * that at least one role binding defers to, in declaration order.
 *
 * This is what the New run page asks for, and it is deliberately *only* this — a role
 * the configuration pinned to a model outright was decided when the configuration was
 * written and is never asked about again.
 *
 * A configuration saved before model slots existed declares none and binds no primary
 * role; it is treated as declaring a `primary` slot, so it keeps launching exactly as
 * it did (one model, asked for once).
 */
export function launchModelSlots(set: GgCapabilitySet): GgModelSlot[] {
  const declared = set.modelSlots ?? [];
  const bindings = set.slots ?? [];
  const out: GgModelSlot[] = [];
  const push = (slot: GgModelSlot) => {
    if (!out.some((s) => s.name === slot.name)) out.push(slot);
  };
  for (const declaration of declared) {
    if (bindings.some((b) => b.modelSlot === declaration.name)) {
      push(declaration);
    }
  }
  // A binding that names a slot the set never declared still needs a model, so offer
  // it rather than launching a run gg would refuse.
  for (const binding of bindings) {
    if (binding.modelSlot) push({ name: binding.modelSlot });
  }
  if (!bindings.some((b) => b.slot === PRIMARY_SLOT)) {
    push({ name: PRIMARY_SLOT });
  }
  return out;
}

/**
 * The capability set to launch a run with: every [deferred](launchModelSlots) binding
 * resolved to the model the launcher collected for its slot (keyed by model-slot
 * name), and the declarations dropped — what runs is a fully pinned set, which is
 * also what the run records and what result aggregation slices by.
 *
 * A role the configuration pinned itself is untouched.
 */
export function bindModelSlots(
  set: GgCapabilitySet,
  models: Record<string, string>,
): GgCapabilitySet {
  const slots: GgSlotBinding[] = (set.slots ?? []).map((binding) => {
    if (!binding.modelSlot) return binding;
    return {
      slot: binding.slot,
      modelId: (models[binding.modelSlot] ?? "").trim(),
    };
  });
  // The legacy shape: no primary binding at all, its model collected against an
  // implicit `primary` slot.
  if (!slots.some((s) => s.slot === PRIMARY_SLOT)) {
    slots.unshift({
      slot: PRIMARY_SLOT,
      modelId: (models[PRIMARY_SLOT] ?? "").trim(),
    });
  }
  const { modelSlots: _declarations, ...rest } = set;
  return { ...rest, slots };
}
