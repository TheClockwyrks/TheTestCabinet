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
} from "../../../store/appSettings";
import runExec from "../RunExec.module.scss";
import gg from "./NewGgRunPage.module.scss";

// The one slot a Phase-0 gg run must bind — the primary model that drives the
// agent loop. The backend 400s a capability set that leaves it unbound.
const PRIMARY_SLOT = "primary";

// The offline mock model: an in-repo scripted "builder" that drives a gg run with
// no provider API key, so a run can be launched and watched end to end without
// credentials. Surfaced as an explicit toggle on the primary slot.
const MOCK_MODEL_ID = "mock/scripted-builder";
const MOCK_PROVIDER = "mock";

// The Phase-0 capabilities gg ships, each with a one-line purpose shown in the
// form. An open string id (not a closed enum) so later phases add capabilities
// without touching this list's shape.
const PHASE0_CAPABILITIES: ReadonlyArray<{
  id: string;
  name: string;
  purpose: string;
}> = [
  {
    id: "shell",
    name: "Shell",
    purpose:
      "Run shell commands in the run container — build, test, and drive tooling.",
  },
  {
    id: "filesystem",
    name: "Filesystem",
    purpose: "Read, write, and list files in the run's workspace.",
  },
];

// The default retry count and its ceiling, mirroring the backend's
// DEFAULT_RETRY_COUNT / MAX_RETRY_COUNT (same semantics as a conventional run).
const DEFAULT_RETRY_COUNT = 1;
const RETRY_COUNT_MAX = 10;

// The built-in presets every operator starts with. "minimal" is the canonical
// Phase-0 set (both capabilities on, primary slot to bind); "shell-only" drops
// the filesystem capability for a toolset-ablation arm. Neither pins a model —
// the operator binds the primary slot per run.
const BLANK_MODEL: Pick<GgPresetConfig, "mockModel" | "modelId" | "provider"> = {
  mockModel: false,
  modelId: "",
  provider: "",
};
const BUILT_IN_PRESETS: ReadonlyArray<GgSavedPreset> = [
  {
    name: "minimal",
    config: {
      capabilities: {
        shell: { enabled: true, paramsText: "" },
        filesystem: { enabled: true, paramsText: "" },
      },
      ...BLANK_MODEL,
    },
  },
  {
    name: "shell-only",
    config: {
      capabilities: {
        shell: { enabled: true, paramsText: "" },
        filesystem: { enabled: false, paramsText: "" },
      },
      ...BLANK_MODEL,
    },
  },
];

type CapabilityDrafts = Record<string, GgCapabilityDraft>;

// Fill in a full draft map from a (possibly partial) preset config, so every
// Phase-0 capability has a row even if the preset predates it.
function draftsFromConfig(config: GgPresetConfig): CapabilityDrafts {
  const out: CapabilityDrafts = {};
  for (const cap of PHASE0_CAPABILITIES) {
    out[cap.id] = config.capabilities[cap.id] ?? {
      enabled: false,
      paramsText: "",
    };
  }
  return out;
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

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Configure and launch one gg run, then hand off to the live gg monitor. gg is
// its own run mode: instead of a harness/model/orchestrator tuple, a run is
// configured by a capability set — which capabilities are on, their params, and
// the model-slot bindings — assembled here (the console is gg's only config
// surface, since gg is headless). The test case + variant are the only dimensions
// shared with a conventional run.
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
  // The form opens on the built-in "minimal" preset (both capabilities on, primary
  // slot to bind). `presetName` records which preset the current config came from
  // (serialized to `GgCapabilitySet.preset`); any hand edit clears it back to a
  // hand-assembled configuration.
  const [drafts, setDrafts] = useState<CapabilityDrafts>(() =>
    draftsFromConfig(BUILT_IN_PRESETS[0]!.config),
  );
  const [mockModel, setMockModelState] = useState(false);
  const [modelId, setModelIdState] = useState("");
  const [provider, setProviderState] = useState("");
  const [presetName, setPresetName] = useState<string>(BUILT_IN_PRESETS[0]!.name);
  const [newPresetName, setNewPresetName] = useState("");

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
  function setEnabled(id: string, enabled: boolean) {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? { enabled, paramsText: "" }), enabled },
    }));
    setPresetName("");
  }
  function setParamsText(id: string, paramsText: string) {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? { enabled: true, paramsText }), paramsText },
    }));
    setPresetName("");
  }
  function setMockModel(next: boolean) {
    setMockModelState(next);
    setPresetName("");
  }
  function setModelId(next: string) {
    setModelIdState(next);
    setPresetName("");
  }
  function setProvider(next: string) {
    setProviderState(next);
    setPresetName("");
  }

  // The presets offered in the dropdown: built-ins first, then the operator's
  // saved ones. A saved preset with a built-in's name overrides it.
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
    setMockModelState(preset.config.mockModel);
    setModelIdState(preset.config.modelId);
    setProviderState(preset.config.provider);
    setPresetName(name);
  }

  // The current form config, as a reusable (test-case-free) preset would store it.
  const currentConfig = (): GgPresetConfig => ({
    capabilities: drafts,
    mockModel,
    modelId,
    provider,
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

  // --- Validation -----------------------------------------------------------
  const paramsErrors: Record<string, string | null> = {};
  for (const cap of PHASE0_CAPABILITIES) {
    const draft = drafts[cap.id];
    if (!draft?.enabled) {
      paramsErrors[cap.id] = null;
      continue;
    }
    const parsed = parseParams(draft.paramsText);
    paramsErrors[cap.id] = parsed.ok ? null : parsed.error;
  }
  const paramsAllValid = Object.values(paramsErrors).every((e) => e === null);
  const hasPrimaryModel = mockModel || modelId.trim().length > 0;

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
      hasPrimaryModel &&
      paramsAllValid &&
      !launching,
  );

  // The reason the launch is blocked, shown beside the button so the operator
  // knows what to fix (the primary-slot binding is the common one).
  const blockedReason = (): string | null => {
    if (!worker || mismatched || signedOut) return null; // covered by the notices above
    if (!sel.slug || !sel.version || !sel.variant) return "Select a test case.";
    if (!hasPrimaryModel)
      return "Bind a model to the primary slot to launch (pick a model or use the offline mock).";
    if (!paramsAllValid) return "Fix the capability params before launching.";
    return null;
  };

  // --- Serialize + launch ---------------------------------------------------
  function buildCapabilitySet(): GgCapabilitySet {
    const capabilities: GgCapabilityConfig[] = PHASE0_CAPABILITIES.map((cap) => {
      const draft = drafts[cap.id];
      const parsed = parseParams(draft?.paramsText ?? "");
      return {
        id: cap.id,
        enabled: Boolean(draft?.enabled),
        // Record the config even for a disabled capability, so an ablation's
        // on/off arms stay symmetric.
        params: parsed.ok ? parsed.value : {},
      };
    });
    const effectiveModelId = mockModel ? MOCK_MODEL_ID : modelId.trim();
    const effectiveProvider = mockModel
      ? MOCK_PROVIDER
      : provider.trim() || undefined;
    const slot: GgSlotBinding = {
      slot: PRIMARY_SLOT,
      modelId: effectiveModelId,
      ...(effectiveProvider ? { provider: effectiveProvider } : {}),
    };
    return {
      ...(presetName ? { preset: presetName } : {}),
      capabilities,
      slots: [slot],
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

      {/* Capability set — gg's first-class configuration surface. */}
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
          <span className={runExec.fieldLabel}>Save current as…</span>
          <input
            className={runExec.input}
            type="text"
            value={newPresetName}
            onChange={(e) => setNewPresetName(e.target.value)}
            placeholder="preset name"
          />
        </label>
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
          className={runExec.danger}
          onClick={onDeletePreset}
          disabled={!isCustomPreset(presetName)}
          title={
            isCustomPreset(presetName)
              ? `Delete the saved preset "${presetName}"`
              : "Only your saved presets can be deleted"
          }
        >
          Delete preset
        </button>
      </div>

      <div className={gg.capList}>
        {PHASE0_CAPABILITIES.map((cap) => {
          const draft = drafts[cap.id];
          const enabled = Boolean(draft?.enabled);
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
                <div className={gg.capParams}>
                  <span className={runExec.fieldLabel}>
                    Params (optional JSON object)
                  </span>
                  <textarea
                    className={`${runExec.textarea} ${gg.paramsInput}`}
                    value={draft?.paramsText ?? ""}
                    onChange={(e) => setParamsText(cap.id, e.target.value)}
                    placeholder={'e.g. { "maxTurns": 40 }'}
                    spellCheck={false}
                  />
                  {error && <span className={gg.fieldError}>{error}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Primary model slot — required; the mock lets a run go with no API key. */}
      <p className={`${runExec.sectionLabel} ${runExec.sectionLabelBackdrop}`}>
        Primary model slot
      </p>
      <div className={gg.slotBlock}>
        <label className={gg.mockToggle}>
          <input
            type="checkbox"
            checked={mockModel}
            onChange={(e) => setMockModel(e.target.checked)}
          />
          <span>Mock (offline scripted builder — no API key)</span>
        </label>
        {mockModel ? (
          <p className={runExec.muted}>
            The primary slot binds <code>{MOCK_MODEL_ID}</code> ({MOCK_PROVIDER}).
            The run executes offline against the scripted builder — no provider
            credentials required.
          </p>
        ) : (
          <div className={gg.slotFields}>
            <label className={`${runExec.field} ${gg.slotModelField}`}>
              <span className={runExec.fieldLabel}>Model</span>
              <ModelCombobox
                value={modelId}
                onChange={setModelId}
                models={models}
                inputClassName={runExec.input}
                placeholder="model id (e.g. claude-opus-4-8)"
              />
            </label>
            <label className={`${runExec.field} ${gg.slotProviderField}`}>
              <span className={runExec.fieldLabel}>Provider (optional)</span>
              <input
                className={runExec.input}
                type="text"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                placeholder="inferred from id"
              />
            </label>
          </div>
        )}
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
