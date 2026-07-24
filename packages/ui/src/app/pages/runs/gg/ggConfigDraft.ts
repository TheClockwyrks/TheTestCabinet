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
  GgSlotBinding,
} from "@test-cabinet/run-record/gg";
import {
  ALL_CAP_IDS,
  CAPABILITIES,
  DEFAULT_CAP_IDS,
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

// One model-slot binding as the editor holds it: a slot name (e.g. "primary",
// "reviewer") bound either to the offline mock model or to a real model id (with an
// optional pinned provider). The multi-model capability lets a run bind several,
// each possibly cross-provider. A saved configuration may leave a slot *unbound*:
// unlike a launch, a stored configuration is reusable across models, and the
// new-run form binds the primary slot from its own model picker.
export interface GgSlotDraft {
  slot: string;
  mockModel: boolean;
  modelId: string;
  provider: string;
}

// A whole gg configuration as the editor holds it, minus the test case/variant
// (those are per-run, never part of a reusable configuration): the per-capability
// drafts keyed by capability id, the model-slot bindings, and the per-tool ablation
// overrides.
export interface GgConfigDraft {
  capabilities: Record<string, GgCapabilityDraft>;
  slots: GgSlotDraft[];
  disabledTools: string[];
}

/** A capability row that is off, unconfigured, and carries no params. */
export function blankCapabilityDraft(): GgCapabilityDraft {
  return { enabled: false, implementation: "", params: {}, paramsText: "" };
}

/** A single blank primary-slot binding — the starting point of a fresh draft. */
export function blankPrimarySlot(): GgSlotDraft {
  return { slot: PRIMARY_SLOT, mockModel: false, modelId: "", provider: "" };
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
    slots: draft.slots.map((s) => ({ ...s })),
    disabledTools: [...draft.disabledTools],
  };
}

/** A blank draft: every catalog capability present and off, one primary slot. */
export function emptyDraft(): GgConfigDraft {
  return {
    capabilities: draftsFor([]),
    slots: [blankPrimarySlot()],
    disabledTools: [],
  };
}

// --- Capability set <-> draft ---------------------------------------------------

/**
 * Fill a draft from a stored capability set, so every catalog capability has a row
 * even if the set predates it (or omits it, which means off).
 */
export function draftFromCapabilitySet(set: GgCapabilitySet): GgConfigDraft {
  const stored = new Map(
    (set.capabilities ?? []).map((cap) => [cap.id, cap] as const),
  );
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
    mockModel: s.modelId === MOCK_MODEL_ID,
    modelId: s.modelId === MOCK_MODEL_ID ? "" : s.modelId,
    provider: s.modelId === MOCK_MODEL_ID ? "" : (s.provider ?? ""),
  }));
  if (!slots.some((s) => s.slot === PRIMARY_SLOT)) {
    slots.unshift(blankPrimarySlot());
  }
  return { capabilities, slots, disabledTools: [...(set.disabledTools ?? [])] };
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

/** Whether a slot draft names a model (the mock counts). */
export function slotHasBinding(slot: GgSlotDraft): boolean {
  return slot.mockModel || slot.modelId.trim().length > 0;
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
 * configuration may leave slots unbound (the launcher supplies the model), so this
 * only rejects structurally broken slot names and unparseable params.
 */
export function draftSaveError(draft: GgConfigDraft): string | null {
  const names = draft.slots.map((s) => s.slot.trim());
  if (names.some((n) => !n)) return "Every model slot needs a name.";
  if (new Set(names).size !== names.length)
    return "Model slot names must be unique.";
  const failed = Object.entries(draftParamErrors(draft)).find(
    ([, error]) => error !== null,
  );
  if (failed) return `Fix the ${failed[0]} params before saving.`;
  return null;
}

/**
 * Serialize a draft into the wire capability set. `preset` records the name the set
 * was assembled from (a run's slice-by facet); pass `null` for a hand-assembled
 * one. A slot left unbound is dropped — a binding with no model is not a binding —
 * so the caller (the launcher) can bind the primary slot itself.
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
  return {
    ...(preset ? { preset } : {}),
    capabilities,
    slots,
    ...(draft.disabledTools.length
      ? { disabledTools: draft.disabledTools }
      : {}),
  };
}

/**
 * The capability set to launch a run with: the configuration's set with the primary
 * slot bound to the model the launcher collected (the mock model gets the mock
 * provider). Any non-primary slot the configuration binds is kept as-is — that is
 * the point of saving them — so one configuration serves a whole sweep of primary
 * models.
 */
export function bindPrimarySlot(
  set: GgCapabilitySet,
  primaryModelId: string,
): GgCapabilitySet {
  const mock = primaryModelId === MOCK_MODEL_ID;
  const primary: GgSlotBinding = {
    slot: PRIMARY_SLOT,
    modelId: primaryModelId,
    ...(mock ? { provider: MOCK_PROVIDER } : {}),
  };
  return {
    ...set,
    slots: [
      primary,
      ...(set.slots ?? []).filter((s) => s.slot !== PRIMARY_SLOT),
    ],
  };
}
