import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useAuth } from "../../../../client/auth";
import { useBackend, useWorkers } from "../../../../client/context";
import type { Model } from "../../../../client/types";
import type {
  GgCapabilityConfig,
  GgCapabilitySet,
  GgSlotBinding,
} from "@test-cabinet/run-record/gg";
import type { GgRunRequest } from "@test-cabinet/run-record/jobs-api";
import { ModelCombobox } from "../../../components/ModelCombobox";
import { PageLayout } from "../../../components/PageLayout";
import { PromptHeader } from "../../../components/PromptHeader";
import { routes } from "../../../routes";
import { familyOf } from "../../../data/families";
import { useCatalog } from "../../../runtime/useCatalog";
import { useTestCaseName } from "../../../data/useTestCaseName";
import { useTestCases } from "../../../data/useTestCases";
import {
  CATALOG_CATEGORIES,
  categoryOf,
  type CatalogCategory,
} from "../../../data/testCaseTabs";
import {
  useAppSettings,
  type GgCapabilityDraft,
  type GgPresetConfig,
  type GgSavedPreset,
  type GgSlotDraft,
} from "../../../store/appSettings";
import runExec from "../RunExec.module.scss";
import gg from "./NewGgRunPage.module.scss";
import {
  ALL_CAP_IDS,
  CAPABILITIES,
  CAP_GROUPS,
  COMMON_ROLE_SLOTS,
  DEFAULT_CAP_IDS,
  MOCK_MODEL_ID,
  MOCK_PROVIDER,
  PRIMARY_SLOT,
  type CapGroup,
  type CapSpec,
} from "./ggCatalog";

// The default retry count and its ceiling, mirroring the backend's
// DEFAULT_RETRY_COUNT / MAX_RETRY_COUNT (same semantics as a conventional run).
const DEFAULT_RETRY_COUNT = 1;
const RETRY_COUNT_MAX = 10;

// gg reaches every slot's model through OpenRouter, so a slot must be bound to the
// model's *OpenRouter* slug (`openai/gpt-5.6-sol`), never a provider-native one
// (`gpt-5.6-sol`, which only the Codex CLI answers to). Scoping the picker to this
// family makes it commit the right alias for a model catalogued under several.
const GG_MODEL_FAMILY = familyOf("gg");

type CapabilityDrafts = Record<string, GgCapabilityDraft>;

function blankDraft(): GgCapabilityDraft {
  return { enabled: false, implementation: "", params: {}, paramsText: "" };
}

// Build a full draft map with every catalog capability present, the given ids on,
// applying optional per-capability param defaults (for the built-in presets).
function draftsFor(
  enabledIds: ReadonlyArray<string>,
  paramDefaults: Record<string, Record<string, string>> = {},
): CapabilityDrafts {
  const out: CapabilityDrafts = {};
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

// A single blank primary-slot binding — the starting point for a fresh form.
function blankPrimarySlot(): GgSlotDraft {
  return { slot: PRIMARY_SLOT, mockModel: false, modelId: "", provider: "" };
}

// --- Built-in presets -----------------------------------------------------------
//
// Every operator starts with these. A study is a sweep over presets, so they cover
// the useful arms: "full" (everything on), "minimal" (the default set), "no-compaction"
// (full minus the compaction backstop), and "shell-only" (an ablation extreme). None
// pins a model — the operator binds the slots per run.
const FULL_PARAM_DEFAULTS: Record<string, Record<string, string>> = {
  compaction: { triggerFullness: "0.85" },
  subagents: { maxParallel: "4", maxDepth: "3" },
};

function presetConfig(
  enabledIds: ReadonlyArray<string>,
  paramDefaults: Record<string, Record<string, string>> = {},
): GgPresetConfig {
  return {
    capabilities: draftsFor(enabledIds, paramDefaults),
    slots: [blankPrimarySlot()],
    disabledTools: [],
  };
}

const BUILT_IN_PRESETS: ReadonlyArray<GgSavedPreset> = [
  { name: "full", config: presetConfig(ALL_CAP_IDS, FULL_PARAM_DEFAULTS) },
  { name: "minimal", config: presetConfig(DEFAULT_CAP_IDS) },
  {
    name: "no-compaction",
    config: presetConfig(
      ALL_CAP_IDS.filter((id) => id !== "compaction"),
      FULL_PARAM_DEFAULTS,
    ),
  },
  { name: "shell-only", config: presetConfig(["shell"]) },
];

// The default preset the form opens on: the launchable minimal set.
const INITIAL_PRESET = BUILT_IN_PRESETS[1]!;

// --- Config <-> draft helpers ---------------------------------------------------

// Fill a full draft map from a (possibly partial or legacy) preset config, so every
// catalog capability has a row even if the preset predates it.
function draftsFromConfig(config: GgPresetConfig): CapabilityDrafts {
  const out: CapabilityDrafts = {};
  for (const cap of CAPABILITIES) {
    const stored = config.capabilities[cap.id];
    out[cap.id] = stored
      ? {
          enabled: stored.enabled,
          implementation: stored.implementation ?? "",
          params: { ...(stored.params ?? {}) },
          paramsText: stored.paramsText ?? "",
        }
      : blankDraft();
  }
  return out;
}

// The slot bindings a preset config holds, migrating a legacy single-primary preset
// (mockModel/modelId/provider fields, no `slots`) into the multi-slot shape and
// guaranteeing a primary slot is present.
function slotsFromConfig(config: GgPresetConfig): GgSlotDraft[] {
  let slots: GgSlotDraft[];
  if (config.slots && config.slots.length > 0) {
    slots = config.slots.map((s) => ({
      slot: s.slot,
      mockModel: Boolean(s.mockModel),
      modelId: s.modelId ?? "",
      provider: s.provider ?? "",
    }));
  } else {
    slots = [
      {
        slot: PRIMARY_SLOT,
        mockModel: Boolean(config.mockModel),
        modelId: config.modelId ?? "",
        provider: config.provider ?? "",
      },
    ];
  }
  if (!slots.some((s) => s.slot === PRIMARY_SLOT)) {
    slots.unshift(blankPrimarySlot());
  }
  return slots;
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

// Validate + fold a capability's dedicated param controls into its JSON params. A
// dedicated control's value overrides the same key in the raw JSON. Returns an error
// string on the first invalid field/JSON (only meaningful when the capability is on).
function capabilityParams(
  cap: CapSpec,
  draft: GgCapabilityDraft,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
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

function slotHasBinding(s: GgSlotDraft): boolean {
  return s.mockModel || s.modelId.trim().length > 0;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Configure and launch one gg run, then hand off to the live gg monitor. gg is its
// own run mode: instead of a harness/model/orchestrator tuple, a run is configured by
// a capability set — which capabilities are on, their implementations/params, the
// model-slot bindings, and any per-tool ablation overrides — assembled here (the
// console is gg's only config surface, since gg is headless). The test case + variant
// are the only dimensions shared with a conventional run.
export function NewGgRunPage() {
  const navigate = useNavigate();
  const { client: backend } = useBackend();
  const { active: worker } = useWorkers();
  const { token } = useAuth();

  // A Run-with-gg entry point can preselect a case via `?slug=…&version=…&variant=…`,
  // mirroring the conventional new-run form.
  const [params] = useSearchParams();
  const navSlug = params.get("slug");
  const sel = useCatalog({
    slug: navSlug,
    version: params.get("version"),
    variant: params.get("variant"),
  });
  const testCaseName = useTestCaseName();
  const { testCases: summaries } = useTestCases();
  const summaryBySlug = useMemo(
    () => new Map(summaries.map((s) => [s.slug, s])),
    [summaries],
  );
  const slugCategory = (slug: string): CatalogCategory | null => {
    const summary = summaryBySlug.get(slug);
    return summary ? categoryOf(summary) : null;
  };

  const [category, setCategory] = useState<CatalogCategory | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [maxRuntime, setMaxRuntime] = useState("");
  const [retryCount, setRetryCount] = useState(DEFAULT_RETRY_COUNT);

  // --- Capability set state -------------------------------------------------
  //
  // The form opens on the built-in "minimal" preset. `presetName` records which
  // preset the current config came from (serialized to `GgCapabilitySet.preset`); any
  // hand edit clears it back to a hand-assembled configuration.
  const [drafts, setDrafts] = useState<CapabilityDrafts>(() =>
    draftsFromConfig(INITIAL_PRESET.config),
  );
  const [slots, setSlots] = useState<GgSlotDraft[]>(() =>
    slotsFromConfig(INITIAL_PRESET.config),
  );
  const [disabledTools, setDisabledTools] = useState<string[]>([]);
  const [presetName, setPresetName] = useState<string>(INITIAL_PRESET.name);
  const [newPresetName, setNewPresetName] = useState("");
  const [collapsed, setCollapsed] = useState<Set<CapGroup>>(
    () => new Set(CAP_GROUPS.filter((g) => !g.startOpen).map((g) => g.group)),
  );

  const ggPresets = useAppSettings((s) => s.ggPresets);
  const saveGgPreset = useAppSettings((s) => s.saveGgPreset);
  const deleteGgPreset = useAppSettings((s) => s.deleteGgPreset);

  const [launchError, setLaunchError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);

  useEffect(() => {
    if (!backend) return;
    backend
      .listModels()
      .then(setModels)
      .catch(() => {
        // The model catalog is optional; the picker still accepts free-text ids.
      });
  }, [backend]);

  // --- Test-case category selection (ported from the conventional new-run form)
  const activeCategory: CatalogCategory =
    category ??
    (navSlug ? slugCategory(navSlug) : null) ??
    CATALOG_CATEGORIES[0]!.value;

  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current || category !== null || !sel.slug) return;
    const currentCategory = slugCategory(sel.slug);
    if (currentCategory === null) return;
    initialized.current = true;
    if (navSlug) {
      setCategory(currentCategory);
      return;
    }
    const target = CATALOG_CATEGORIES[0]!.value;
    setCategory(target);
    if (currentCategory !== target) {
      const first = [...sel.cases]
        .filter((c) => slugCategory(c.slug) === target)
        .sort((a, b) =>
          testCaseName(a.slug).localeCompare(testCaseName(b.slug)),
        )[0];
      if (first) sel.setSlug(first.slug);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, sel.slug, sel.cases, summaryBySlug, navSlug]);

  function onCategoryChange(next: CatalogCategory) {
    setCategory(next);
    if (slugCategory(sel.slug) === next) return;
    const first = [...sel.cases]
      .filter((c) => slugCategory(c.slug) === next)
      .sort((a, b) => testCaseName(a.slug).localeCompare(testCaseName(b.slug)))[0];
    if (first) sel.setSlug(first.slug);
  }

  const sortedCases = useMemo(
    () =>
      [...sel.cases]
        .filter((c) => slugCategory(c.slug) === activeCategory)
        .sort((a, b) =>
          testCaseName(a.slug).localeCompare(testCaseName(b.slug)),
        ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sel.cases, testCaseName, summaryBySlug, activeCategory],
  );

  const versions = [
    ...(sel.cases.find((c) => c.slug === sel.slug)?.versions ?? []),
  ].reverse();

  // --- Capability-set mutators (each hand edit un-names the preset) ----------
  function unname() {
    setPresetName("");
  }
  function updateDraft(id: string, patch: Partial<GgCapabilityDraft>) {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? blankDraft()), ...patch },
    }));
    unname();
  }
  function setEnabled(id: string, enabled: boolean) {
    updateDraft(id, { enabled });
  }
  function setImplementation(id: string, implementation: string) {
    updateDraft(id, { implementation });
  }
  function setParam(id: string, key: string, value: string) {
    setDrafts((prev) => {
      const base = prev[id] ?? blankDraft();
      return {
        ...prev,
        [id]: { ...base, params: { ...(base.params ?? {}), [key]: value } },
      };
    });
    unname();
  }
  function setParamsText(id: string, paramsText: string) {
    updateDraft(id, { paramsText });
  }

  // --- Slot mutators --------------------------------------------------------
  function updateSlot(index: number, patch: Partial<GgSlotDraft>) {
    setSlots((prev) =>
      prev.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    );
    unname();
  }
  function addSlot() {
    setSlots((prev) => [
      ...prev,
      { slot: "", mockModel: false, modelId: "", provider: "" },
    ]);
    unname();
  }
  function removeSlot(index: number) {
    setSlots((prev) => prev.filter((_, i) => i !== index));
    unname();
  }

  // --- Toolset-ablation mutator ---------------------------------------------
  function toggleToolDisabled(tool: string, disabled: boolean) {
    setDisabledTools((prev) =>
      disabled ? [...new Set([...prev, tool])] : prev.filter((t) => t !== tool),
    );
    unname();
  }

  function toggleGroup(group: CapGroup) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }

  // The presets offered in the dropdown: built-ins first, then the operator's saved
  // ones. A saved preset with a built-in's name overrides it.
  const allPresets = useMemo<GgSavedPreset[]>(() => {
    const savedNames = new Set(ggPresets.map((p) => p.name));
    return [
      ...BUILT_IN_PRESETS.filter((p) => !savedNames.has(p.name)),
      ...ggPresets,
    ];
  }, [ggPresets]);
  const isCustomPreset = (name: string) =>
    ggPresets.some((p) => p.name === name);

  function applyPreset(name: string) {
    const preset = allPresets.find((p) => p.name === name);
    if (!preset) return;
    setDrafts(draftsFromConfig(preset.config));
    setSlots(slotsFromConfig(preset.config));
    setDisabledTools([...(preset.config.disabledTools ?? [])]);
    setPresetName(name);
  }

  // The current form config, as a reusable (test-case-free) preset would store it.
  const currentConfig = (): GgPresetConfig => ({
    capabilities: drafts,
    slots,
    disabledTools,
  });

  function onSavePreset() {
    const name = newPresetName.trim();
    if (!name) return;
    saveGgPreset(name, currentConfig());
    setPresetName(name);
    setNewPresetName("");
  }
  function onDeletePreset() {
    if (!isCustomPreset(presetName)) return;
    deleteGgPreset(presetName);
    setPresetName("");
  }
  function onRenamePreset() {
    const name = newPresetName.trim();
    if (!name || !isCustomPreset(presetName) || name === presetName) return;
    saveGgPreset(name, currentConfig());
    deleteGgPreset(presetName);
    setPresetName(name);
    setNewPresetName("");
  }

  // --- Validation -----------------------------------------------------------
  const paramsErrors: Record<string, string | null> = {};
  for (const cap of CAPABILITIES) {
    const draft = drafts[cap.id];
    if (!draft?.enabled) {
      paramsErrors[cap.id] = null;
      continue;
    }
    const parsed = capabilityParams(cap, draft);
    paramsErrors[cap.id] = parsed.ok ? null : parsed.error;
  }
  const paramsAllValid = Object.values(paramsErrors).every((e) => e === null);

  const primarySlot = slots.find((s) => s.slot === PRIMARY_SLOT);
  const hasPrimaryModel = Boolean(primarySlot && slotHasBinding(primarySlot));
  const slotNames = slots.map((s) => s.slot.trim());
  const hasBlankSlotName = slots.some((s) => !s.slot.trim());
  const hasUnboundSlot = slots.some((s) => !slotHasBinding(s));
  const hasDupSlot = new Set(slotNames).size !== slotNames.length;
  const slotsValid =
    hasPrimaryModel && !hasBlankSlotName && !hasUnboundSlot && !hasDupSlot;

  const mismatched = worker?.backendMatch === "mismatch";
  const needsAuth = Boolean(worker && !worker.local);
  const signedOut = needsAuth && !token;

  const canLaunch = Boolean(
    worker &&
      !mismatched &&
      !signedOut &&
      sel.slug &&
      sel.version &&
      sel.variant &&
      slotsValid &&
      paramsAllValid &&
      !launching,
  );

  // The reason the launch is blocked, shown beside the button so the operator knows
  // what to fix (the primary-slot binding is the common one).
  const blockedReason = (): string | null => {
    if (!worker || mismatched || signedOut) return null; // covered by the notices above
    if (!sel.slug || !sel.version || !sel.variant) return "Select a test case.";
    if (!hasPrimaryModel)
      return "Bind a model to the primary slot to launch (pick a model or use the offline mock).";
    if (hasBlankSlotName) return "Every model slot needs a name.";
    if (hasDupSlot) return "Model slot names must be unique.";
    if (hasUnboundSlot) return "Every model slot must bind a model.";
    if (!paramsAllValid) return "Fix the capability params before launching.";
    return null;
  };

  // --- Serialize + launch ---------------------------------------------------
  function buildCapabilitySet(): GgCapabilitySet {
    const capabilities: GgCapabilityConfig[] = CAPABILITIES.map((cap) => {
      const draft = drafts[cap.id] ?? blankDraft();
      const parsed = capabilityParams(cap, draft);
      const impl = draft.implementation?.trim();
      return {
        id: cap.id,
        enabled: Boolean(draft.enabled),
        ...(impl ? { implementation: impl } : {}),
        // Record the config even for a disabled capability, so an ablation's on/off
        // arms stay symmetric.
        params: parsed.ok ? parsed.value : {},
      };
    });
    const slotBindings: GgSlotBinding[] = slots.map((s) => {
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
      ...(presetName ? { preset: presetName } : {}),
      capabilities,
      slots: slotBindings,
      ...(disabledTools.length ? { disabledTools } : {}),
    };
  }

  async function onLaunch() {
    if (!worker) return;
    setLaunchError(null);
    setLaunching(true);
    try {
      const req: GgRunRequest = {
        testCase: sel.slug,
        version: sel.version,
        variant: sel.variant,
        capabilitySet: buildCapabilitySet(),
        // Omit the override entirely when blank so the case's default runtime
        // applies (the field is optional, not nullable).
        ...(maxRuntime ? { maxRuntimeSeconds: Number(maxRuntime) } : {}),
        retryCount,
      };
      const ack = await worker.client.launchGgRun(req, token ?? "");
      navigate(routes.ggMonitor(ack.jobId));
    } catch (e) {
      // Surface the backend's validation reason (missing primary slot, unknown
      // version/variant, …) inline rather than swallowing it.
      setLaunchError(errorMessage(e));
    } finally {
      setLaunching(false);
    }
  }

  // Capabilities that offer tools, for the toolset-ablation surface.
  const ablatableCaps = CAPABILITIES.filter((c) => c.tools && c.tools.length > 0);

  return (
    <PageLayout>
      <PromptHeader
        command="--gg new"
        comment={<>// assemble a capability set &amp; launch a gg run</>}
      />

      {!worker && (
        <p className={`${runExec.notice} ${runExec.warn}`}>
          No worker connected — open the connections drawer (the gear in the top
          bar) to add a worker server to run on.
        </p>
      )}
      {mismatched && (
        <p className={`${runExec.notice} ${runExec.error}`}>
          The active worker is bound to a different backend than this console is
          pointed at. Launching is disabled to avoid asking for a test case the
          worker can&rsquo;t resolve.
        </p>
      )}
      {sel.noBackend && (
        <p className={`${runExec.notice} ${runExec.warn}`}>
          No backend configured — the test-case catalog comes from the backend.
        </p>
      )}
      {signedOut && (
        <p className={`${runExec.notice} ${runExec.warn}`}>
          Sign in to launch a run — the backend attributes each enqueued run to
          your account. Use the account control in the top bar to register or log
          in, then launch.
        </p>
      )}

      {/* Test case: the only dimensions shared with a conventional run. */}
      <div className={runExec.fields}>
        <label className={runExec.field}>
          <span className={runExec.fieldLabel}>Test case type</span>
          <select
            className={runExec.select}
            value={activeCategory}
            onChange={(e) => onCategoryChange(e.target.value as CatalogCategory)}
          >
            {CATALOG_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className={runExec.field}>
          <span className={runExec.fieldLabel}>Test case</span>
          <select
            className={runExec.select}
            value={sel.slug}
            onChange={(e) => sel.setSlug(e.target.value)}
          >
            {sortedCases.map((c) => (
              <option key={c.slug} value={c.slug}>
                {testCaseName(c.slug)}
              </option>
            ))}
          </select>
        </label>
        <label className={runExec.field}>
          <span className={runExec.fieldLabel}>Version</span>
          <select
            className={runExec.select}
            value={sel.version}
            onChange={(e) => sel.setVersion(e.target.value)}
          >
            {versions.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className={runExec.field}>
          <span className={runExec.fieldLabel}>Variant</span>
          <select
            className={runExec.select}
            value={sel.variant}
            onChange={(e) => sel.setVariant(e.target.value)}
            disabled={!sel.versionInfo}
          >
            {(sel.versionInfo?.variants ?? []).map((v) => (
              <option key={v.slug} value={v.slug}>
                {v.name} ({v.slug})
              </option>
            ))}
          </select>
        </label>
        <label className={runExec.field}>
          <span className={runExec.fieldLabel}>Max runtime (s, optional)</span>
          <input
            className={runExec.input}
            type="number"
            min={1}
            value={maxRuntime}
            onChange={(e) => setMaxRuntime(e.target.value)}
            placeholder={
              sel.versionInfo
                ? `default ${sel.versionInfo.maxRuntimeSeconds}`
                : "default"
            }
          />
        </label>
        <label
          className={runExec.field}
          title="Auto-retries on infra error or catastrophic failure (not on a timeout or a completed run)."
        >
          <span className={runExec.fieldLabel}>Retry count</span>
          <input
            className={runExec.input}
            type="number"
            min={0}
            max={RETRY_COUNT_MAX}
            step={1}
            value={retryCount}
            onChange={(e) => {
              const n = Math.floor(Number(e.target.value));
              setRetryCount(
                Number.isFinite(n) && n >= 0
                  ? Math.min(n, RETRY_COUNT_MAX)
                  : DEFAULT_RETRY_COUNT,
              );
            }}
          />
        </label>
      </div>

      {/* Preset management — a study is a sweep over presets. */}
      <p className={`${runExec.sectionLabel} ${runExec.sectionLabelBackdrop}`}>
        Capability set
      </p>
      <div className={gg.presetRow}>
        <label className={`${runExec.field} ${gg.presetNameField}`}>
          <span className={runExec.fieldLabel}>Preset</span>
          <select
            className={runExec.select}
            value={presetName}
            onChange={(e) => applyPreset(e.target.value)}
          >
            {presetName === "" && (
              <option value="">(custom — unsaved)</option>
            )}
            {allPresets.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
                {isCustomPreset(p.name) ? "" : " (built-in)"}
              </option>
            ))}
          </select>
        </label>
        <label className={`${runExec.field} ${gg.presetNameField}`}>
          <span className={runExec.fieldLabel}>Save / rename to…</span>
          <input
            className={runExec.input}
            type="text"
            value={newPresetName}
            onChange={(e) => setNewPresetName(e.target.value)}
            placeholder="preset name"
          />
        </label>
        <div className={gg.presetActions}>
          <button
            type="button"
            className={runExec.secondary}
            onClick={onSavePreset}
            disabled={!newPresetName.trim()}
          >
            Save preset
          </button>
          <button
            type="button"
            className={runExec.secondary}
            onClick={onRenamePreset}
            disabled={
              !newPresetName.trim() ||
              !isCustomPreset(presetName) ||
              newPresetName.trim() === presetName
            }
            title={
              isCustomPreset(presetName)
                ? `Rename the saved preset "${presetName}"`
                : "Only your saved presets can be renamed"
            }
          >
            Rename
          </button>
          <button
            type="button"
            className={runExec.danger}
            onClick={onDeletePreset}
            disabled={!isCustomPreset(presetName)}
            title={
              isCustomPreset(presetName)
                ? `Delete the saved preset "${presetName}"`
                : "Only your saved presets can be deleted"
            }
          >
            Delete
          </button>
        </div>
      </div>

      {/* The full capability catalog, grouped by concern, collapsible. */}
      {CAP_GROUPS.map(({ group }) => {
        const groupCaps = CAPABILITIES.filter((c) => c.group === group);
        const isCollapsed = collapsed.has(group);
        const onCount = groupCaps.filter((c) => drafts[c.id]?.enabled).length;
        return (
          <div key={group} className={gg.group}>
            <button
              type="button"
              className={gg.groupHeader}
              onClick={() => toggleGroup(group)}
              aria-expanded={!isCollapsed}
            >
              <span className={gg.groupToggle}>{isCollapsed ? "▸" : "▾"}</span>
              <span className={gg.groupName}>{group}</span>
              <span className={gg.groupCount}>
                {onCount}/{groupCaps.length} on
              </span>
            </button>
            {!isCollapsed && (
              <div className={gg.capList}>
                {groupCaps.map((cap) => {
                  const draft = drafts[cap.id] ?? blankDraft();
                  const enabled = Boolean(draft.enabled);
                  const error = paramsErrors[cap.id];
                  return (
                    <div
                      key={cap.id}
                      className={`${gg.capRow}${enabled ? "" : ` ${gg.capOff}`}`}
                    >
                      <label className={gg.capHeader}>
                        <input
                          className={gg.capCheckbox}
                          type="checkbox"
                          checked={enabled}
                          onChange={(e) => setEnabled(cap.id, e.target.checked)}
                        />
                        <span className={gg.capName}>{cap.name}</span>
                        <span className={gg.capId}>{cap.id}</span>
                      </label>
                      <p className={gg.capPurpose}>{cap.purpose}</p>
                      {enabled && (
                        <div className={gg.capBody}>
                          {(cap.params?.length || cap.implementationLabel) && (
                            <div className={gg.capParamGrid}>
                              {cap.implementationLabel && (
                                <label className={gg.capParamField}>
                                  <span className={runExec.fieldLabel}>
                                    {cap.implementationLabel}
                                  </span>
                                  <input
                                    className={runExec.input}
                                    type="text"
                                    value={draft.implementation ?? ""}
                                    onChange={(e) =>
                                      setImplementation(cap.id, e.target.value)
                                    }
                                    placeholder={
                                      cap.implementationPlaceholder ?? "default"
                                    }
                                    spellCheck={false}
                                  />
                                </label>
                              )}
                              {(cap.params ?? []).map((p) => (
                                <label key={p.key} className={gg.capParamField}>
                                  <span className={runExec.fieldLabel}>
                                    {p.label}
                                  </span>
                                  {p.kind === "select" ? (
                                    <select
                                      className={runExec.select}
                                      value={draft.params?.[p.key] ?? ""}
                                      onChange={(e) =>
                                        setParam(cap.id, p.key, e.target.value)
                                      }
                                    >
                                      {(p.options ?? []).map((o) => (
                                        <option key={o.value} value={o.value}>
                                          {o.label}
                                        </option>
                                      ))}
                                    </select>
                                  ) : (
                                    <input
                                      className={runExec.input}
                                      type="number"
                                      min={0}
                                      max={p.kind === "fraction" ? 1 : undefined}
                                      step={p.kind === "fraction" ? 0.05 : 1}
                                      value={draft.params?.[p.key] ?? ""}
                                      onChange={(e) =>
                                        setParam(cap.id, p.key, e.target.value)
                                      }
                                      placeholder={p.placeholder}
                                    />
                                  )}
                                  {p.hint && (
                                    <span className={gg.paramHint}>{p.hint}</span>
                                  )}
                                </label>
                              ))}
                            </div>
                          )}
                          <details className={gg.advancedParams}>
                            <summary className={gg.advancedSummary}>
                              Advanced params (JSON)
                            </summary>
                            <textarea
                              className={`${runExec.textarea} ${gg.paramsInput}`}
                              value={draft.paramsText}
                              onChange={(e) =>
                                setParamsText(cap.id, e.target.value)
                              }
                              placeholder={'e.g. { "customKnob": 3 }'}
                              spellCheck={false}
                            />
                          </details>
                          {error && (
                            <span className={gg.fieldError}>{error}</span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* Model slots — the multi-model surface. Primary required; the mock lets a
          run go with no API key. Extra slots resolve only when multi-model is on. */}
      <p className={`${runExec.sectionLabel} ${runExec.sectionLabelBackdrop}`}>
        Model slots
      </p>
      <datalist id="gg-role-slots">
        {COMMON_ROLE_SLOTS.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <div className={gg.slotList}>
        {slots.map((slot, i) => {
          const isPrimary = slot.slot === PRIMARY_SLOT && i === 0;
          return (
            <div key={i} className={gg.slotBlock}>
              <div className={gg.slotTop}>
                {isPrimary ? (
                  <span className={gg.slotName}>
                    <span className={gg.capName}>primary</span>
                    <span className={gg.capId}>required</span>
                  </span>
                ) : (
                  <label className={`${runExec.field} ${gg.slotNameField}`}>
                    <span className={runExec.fieldLabel}>Slot</span>
                    <input
                      className={runExec.input}
                      type="text"
                      list="gg-role-slots"
                      value={slot.slot}
                      onChange={(e) => updateSlot(i, { slot: e.target.value })}
                      placeholder="e.g. reviewer"
                    />
                  </label>
                )}
                <label className={gg.mockToggle}>
                  <input
                    type="checkbox"
                    checked={slot.mockModel}
                    onChange={(e) =>
                      updateSlot(i, { mockModel: e.target.checked })
                    }
                  />
                  <span>Mock (offline — no API key)</span>
                </label>
                {!isPrimary && (
                  <button
                    type="button"
                    className={gg.slotRemove}
                    onClick={() => removeSlot(i)}
                    aria-label={`Remove the ${slot.slot || "unnamed"} slot`}
                  >
                    ✕
                  </button>
                )}
              </div>
              {slot.mockModel ? (
                <p className={runExec.muted}>
                  Binds <code>{MOCK_MODEL_ID}</code> ({MOCK_PROVIDER}) — runs
                  offline against the scripted builder, no credentials required.
                </p>
              ) : (
                <div className={gg.slotFields}>
                  <label className={`${runExec.field} ${gg.slotModelField}`}>
                    <span className={runExec.fieldLabel}>Model</span>
                    <ModelCombobox
                      value={slot.modelId}
                      onChange={(v) => updateSlot(i, { modelId: v })}
                      models={models}
                      harnessFamily={GG_MODEL_FAMILY}
                      inputClassName={runExec.input}
                      placeholder="model id (e.g. anthropic/claude-opus-4.8)"
                    />
                  </label>
                  <label className={`${runExec.field} ${gg.slotProviderField}`}>
                    <span className={runExec.fieldLabel}>Provider (optional)</span>
                    <input
                      className={runExec.input}
                      type="text"
                      value={slot.provider}
                      onChange={(e) => updateSlot(i, { provider: e.target.value })}
                      placeholder="inferred from id"
                    />
                  </label>
                </div>
              )}
            </div>
          );
        })}
        <button type="button" className={runExec.secondary} onClick={addSlot}>
          + Add model slot
        </button>
        {!drafts["multi-model"]?.enabled && slots.length > 1 && (
          <p className={runExec.muted}>
            Extra slots resolve only when the <code>multi-model</code> capability
            is on — with it off, every agent falls back to the primary slot.
          </p>
        )}
      </div>

      {/* Toolset ablation — withhold individual tools even when their capability is
          on (the finest-grained ablation lever). */}
      <p className={`${runExec.sectionLabel} ${runExec.sectionLabelBackdrop}`}>
        Toolset ablation
      </p>
      <p className={runExec.muted}>
        Withhold individual tools even when their capability is on — the fine
        ablation lever (e.g. drop <code>edit_file</code> while keeping{" "}
        <code>write_file</code>). A tool whose capability is off is already
        withheld.
      </p>
      <div className={gg.toolList}>
        {ablatableCaps.map((cap) => {
          const capOn = Boolean(drafts[cap.id]?.enabled);
          return (
            <div
              key={cap.id}
              className={`${gg.toolGroup}${capOn ? "" : ` ${gg.toolGroupOff}`}`}
            >
              <span className={gg.toolGroupName}>
                {cap.name}
                {!capOn && (
                  <span className={gg.capId}> capability off</span>
                )}
              </span>
              <div className={gg.toolGrid}>
                {cap.tools!.map((tool) => (
                  <label key={tool} className={gg.toolItem}>
                    <input
                      type="checkbox"
                      checked={disabledTools.includes(tool)}
                      onChange={(e) =>
                        toggleToolDisabled(tool, e.target.checked)
                      }
                    />
                    <code>{tool}</code>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className={runExec.actions}>
        <div className={runExec.actionsEnd}>
          {sel.loading && (
            <span className={runExec.muted}>resolving version…</span>
          )}
          {!sel.loading && blockedReason() && (
            <span className={runExec.muted}>{blockedReason()}</span>
          )}
          <button
            className={runExec.primary}
            onClick={onLaunch}
            disabled={!canLaunch}
          >
            {launching ? "Launching…" : "Launch gg run"}
          </button>
        </div>
      </div>

      {(launchError || sel.error) && (
        <p className={`${runExec.notice} ${runExec.error}`}>
          {launchError ?? sel.error}
        </p>
      )}
    </PageLayout>
  );
}
