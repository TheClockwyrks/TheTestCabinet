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
// The draft keeps param values as *typed text* rather than parsed JSON so an
// in-progress, not-yet-valid edit survives a re-render (and a save round-trip)
// instead of being silently dropped.

import type {
  GgCapabilityConfig,
  GgCapabilitySet,
  GgModelSlot,
  GgSlotBinding,
} from "@test-cabinet/run-record/gg";
import {
  ALL_CAP_IDS,
  CAPABILITIES,
  DEFAULT_CAP_IDS,
  FILESYSTEM_CAP_IDS,
  LEGACY_FILESYSTEM_CAP_ID,
  MOCK_MODEL_ID,
  MOCK_PROVIDER,
  PRIMARY_SLOT,
  type CapSpec,
} from "./ggCatalog";

// One capability's draft state. `enabled` toggles the capability on/off;
// `implementation` is the selected swappable implementation (the A/B lever —
// empty = the capability's default); `params` holds the values of the capability's
// *dedicated* param controls keyed by param name (string form, empty = unset); and
// `paramsText` is the raw JSON typed for any *additional* params (empty = `{}`).
export interface GgCapabilityDraft {
  enabled: boolean;
  implementation?: string;
  params?: Record<string, string>;
  paramsText: string;
}

// One declared **model slot** as the editor holds it: a launch-time model parameter
// with an optional default the new-run form pre-fills and an optional provider pin
// carried onto every binding the slot feeds. Declaring these is what makes one saved
// configuration reusable across models — the operator supplies the models at launch
// instead of the configuration baking them in.
export interface GgModelSlotDraft {
  name: string;
  defaultModelId: string;
  provider: string;
}

// Where a role binding gets its model: from a declared model slot (supplied at
// launch) or pinned here, in the configuration, for every run of it.
export type GgSlotSource = "model-slot" | "model";

// One role binding as the editor holds it. The role (`slot` — "primary",
// "reviewer", …) is what capabilities reference; `source` decides where its model
// comes from. A `model-slot` binding names a declared [GgModelSlotDraft] and is
// filled in at launch; a `model` binding pins the offline mock model or a real model
// id (with an optional provider) and is never asked about again.
export interface GgSlotDraft {
  slot: string;
  source: GgSlotSource;
  modelSlot: string;
  mockModel: boolean;
  modelId: string;
  provider: string;
}

// A whole gg configuration as the editor holds it, minus the test case/variant
// (those are per-run, never part of a reusable configuration): the per-capability
// drafts keyed by capability id, the declared model slots, the role bindings that
// consume them, and the per-tool ablation overrides.
export interface GgConfigDraft {
  capabilities: Record<string, GgCapabilityDraft>;
  modelSlots: GgModelSlotDraft[];
  slots: GgSlotDraft[];
  disabledTools: string[];
}

/** A capability row that is off, unconfigured, and carries no params. */
export function blankCapabilityDraft(): GgCapabilityDraft {
  return { enabled: false, implementation: "", params: {}, paramsText: "" };
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
    mockModel: false,
    modelId: "",
    provider: "",
  };
}

/** The matching `primary` model-slot declaration, with no default. */
export function blankPrimaryModelSlot(): GgModelSlotDraft {
  return { name: PRIMARY_SLOT, defaultModelId: "", provider: "" };
}

/** A blank role binding pinned to no model — a freshly added row. */
export function blankSlot(): GgSlotDraft {
  return {
    slot: "",
    source: "model-slot",
    modelSlot: PRIMARY_SLOT,
    mockModel: false,
    modelId: "",
    provider: "",
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
      params: paramDefaults[cap.id] ? { ...paramDefaults[cap.id] } : {},
      paramsText: "",
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
        { ...cap, params: { ...(cap.params ?? {}) } },
      ]),
    ),
    modelSlots: draft.modelSlots.map((s) => ({ ...s })),
    slots: draft.slots.map((s) => ({ ...s })),
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
    disabledTools: [],
  };
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
    // param to its dedicated control when the catalog declares one, and leave the
    // rest in the advanced JSON field so nothing is lost on a round-trip.
    const dedicated = new Set((cap.params ?? []).map((p) => p.key));
    const params: Record<string, string> = {};
    const extra: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(from.params ?? {})) {
      if (dedicated.has(key)) params[key] = String(value);
      else extra[key] = value;
    }
    capabilities[cap.id] = {
      enabled: from.enabled,
      implementation: from.implementation ?? "",
      params,
      paramsText:
        Object.keys(extra).length > 0 ? JSON.stringify(extra, null, 2) : "",
    };
  }
  const slots: GgSlotDraft[] = (set.slots ?? []).map((s) => ({
    slot: s.slot,
    source: s.modelSlot ? "model-slot" : "model",
    modelSlot: s.modelSlot ?? "",
    mockModel: s.modelId === MOCK_MODEL_ID,
    modelId: s.modelId === MOCK_MODEL_ID ? "" : s.modelId,
    provider: s.modelId === MOCK_MODEL_ID ? "" : (s.provider ?? ""),
  }));
  const modelSlots: GgModelSlotDraft[] = (set.modelSlots ?? []).map((s) => ({
    name: s.name,
    defaultModelId: s.defaultModelId ?? "",
    provider: s.provider ?? "",
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
        provider: "",
      });
    }
  }
  return {
    capabilities,
    modelSlots,
    slots,
    disabledTools: [...(set.disabledTools ?? [])],
  };
}

// The result of parsing a capability's params-JSON text: `{}` for an empty field,
// the parsed object on success, or an error string the form surfaces inline.
type ParamsParse =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string };

function parseParams(text: string): ParamsParse {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, value: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: "Not valid JSON." };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: "Params must be a JSON object." };
  }
  return { ok: true, value: parsed as Record<string, unknown> };
}

/**
 * Validate + fold a capability's dedicated param controls into its JSON params. A
 * dedicated control's value overrides the same key in the raw JSON. Returns an
 * error string on the first invalid field/JSON (only meaningful when the capability
 * is on).
 */
export function capabilityParams(
  cap: CapSpec,
  draft: GgCapabilityDraft,
): ParamsParse {
  const base = parseParams(draft.paramsText);
  if (!base.ok) return base;
  const out: Record<string, unknown> = { ...base.value };
  for (const p of cap.params ?? []) {
    const raw = (draft.params?.[p.key] ?? "").trim();
    if (!raw) continue;
    if (p.kind === "select") {
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
    out[p.key] = n;
  }
  return { ok: true, value: out };
}

/**
 * Whether a role binding resolves to something: a pinned model (the mock counts), or
 * a named model slot the launch will fill in.
 */
export function slotHasBinding(slot: GgSlotDraft): boolean {
  return slot.source === "model-slot"
    ? slot.modelSlot.trim().length > 0
    : slot.mockModel || slot.modelId.trim().length > 0;
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
  return null;
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
      const modelId = s.mockModel ? MOCK_MODEL_ID : s.modelId.trim();
      const provider = s.mockModel
        ? MOCK_PROVIDER
        : s.provider.trim() || undefined;
      return {
        slot: s.slot.trim(),
        modelId,
        ...(provider ? { provider } : {}),
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
      ...(s.provider.trim() ? { provider: s.provider.trim() } : {}),
    }));
  return {
    ...(preset ? { preset } : {}),
    capabilities,
    slots,
    ...(modelSlots.length ? { modelSlots } : {}),
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
 * The model slot's declared provider is carried onto each binding it feeds (the mock
 * model gets the mock provider); a role the configuration pinned itself is untouched.
 */
export function bindModelSlots(
  set: GgCapabilitySet,
  models: Record<string, string>,
): GgCapabilitySet {
  const declared = new Map(
    (set.modelSlots ?? []).map((s) => [s.name, s] as const),
  );
  const resolve = (name: string): GgSlotBinding["provider"] => {
    if (models[name] === MOCK_MODEL_ID) return MOCK_PROVIDER;
    return declared.get(name)?.provider;
  };
  const slots: GgSlotBinding[] = (set.slots ?? []).map((binding) => {
    if (!binding.modelSlot) return binding;
    const provider = resolve(binding.modelSlot);
    return {
      slot: binding.slot,
      modelId: (models[binding.modelSlot] ?? "").trim(),
      ...(provider ? { provider } : {}),
    };
  });
  // The legacy shape: no primary binding at all, its model collected against an
  // implicit `primary` slot.
  if (!slots.some((s) => s.slot === PRIMARY_SLOT)) {
    const modelId = (models[PRIMARY_SLOT] ?? "").trim();
    const provider = resolve(PRIMARY_SLOT);
    slots.unshift({
      slot: PRIMARY_SLOT,
      modelId,
      ...(provider ? { provider } : {}),
    });
  }
  const { modelSlots: _declarations, ...rest } = set;
  return { ...rest, slots };
}
