import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import type { AuthMode, HarnessSlug } from "@test-cabinet/run-record";
import type {
  Comparison,
  ComparisonArm,
  ComparisonInput,
  VariedDimension,
} from "@test-cabinet/run-record/comparison";
import { SegmentedControl, type SegmentedOption } from "@test-cabinet/ui";
import { useAuth } from "../../../client/auth";
import { useBackend } from "../../../client/context";
import type { Model } from "../../../client/types";
import { PageLayout } from "../../components/PageLayout";
import { LoadingState } from "../../components/LoadingState";
import { BackChevron } from "../../components/BackChevron";
import { ModelCombobox } from "../../components/ModelCombobox";
import { harnesses } from "../../data/harnesses";
import { familyOf } from "../../data/families";
import { DEFAULT_ORCHESTRATOR_SLUG } from "../../data/orchestrators";
import { useCatalog } from "../../runtime/useCatalog";
import { useTestCaseName } from "../../data/useTestCaseName";
import { useGgConfigs } from "../runs/gg/useGgConfigs";
import { routes } from "../../routes";
import exec from "../runs/RunExec.module.scss";
import styles from "./Comparisons.module.scss";

const AUTH_MODE_OPTIONS: ReadonlyArray<SegmentedOption<AuthMode>> = [
  { value: "apiKey", label: "API key" },
  { value: "subscription", label: "Subscription" },
];

const VARIED_OPTIONS: ReadonlyArray<SegmentedOption<VariedDimension>> = [
  { value: "harness", label: "Harness" },
  { value: "gg_config", label: "gg configuration" },
  { value: "model", label: "Model" },
];

// A locally-unique arm id (never sent anywhere but the comparison's own config,
// so a `crypto.randomUUID` — falling back to a timestamp+random string on a host
// without it — is exactly as stable as the contract asks for).
function newArmId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `arm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function harnessName(slug: string): string {
  return harnesses.find((h) => h.slug === slug)?.displayName ?? slug;
}

// The comparison create/edit form (`/comparisons/new`, `/comparisons/:id/edit`):
// pick the held-constant controls (case, version, variant, model, auth mode),
// the varied dimension, and the arms for that dimension, plus `N`. Reuses
// `useCatalog` (the new-run form's case/version/variant picker) and
// `ModelCombobox`/`SegmentedControl` exactly as the new-run and coverage-plan
// pages do. Console-only; gated on a signed-in account (a comparison, like a
// coverage plan or a gg configuration, is per-account).
//
// One note on the varied dimension "model": the contract's `ComparisonControls`
// (`@test-cabinet/run-record/comparison`) has no harness field of its own — only
// a harness-varied comparison names one per arm — even though
// docs/comparisons/experiments.md describes varying the model with the harness
// held constant. This form collects that pinned harness alongside the controls
// and threads it onto every model arm's own (otherwise unused) `harnessSlug`
// field, so it round-trips through the opaque `config_json` the backend stores —
// see `comparisonMath.ts`'s `modelArmLaunchItems` for where it is read back.
export function ComparisonEditPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const { token } = useAuth();
  const { client: backend } = useBackend();
  const navigate = useNavigate();
  const testCaseName = useTestCaseName();
  const sel = useCatalog();
  const { saved: ggConfigs } = useGgConfigs();

  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(editing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [modelId, setModelId] = useState("");
  const [authMode, setAuthMode] = useState<AuthMode>("apiKey");
  const [varied, setVaried] = useState<VariedDimension>("harness");
  const [n, setN] = useState(3);
  const [arms, setArms] = useState<ComparisonArm[]>([]);
  // The harness held constant for a "model"-varied comparison (see the module
  // doc above); irrelevant for the other two dimensions.
  const [pinnedHarness, setPinnedHarness] = useState<HarnessSlug>(
    (harnesses[0]?.slug ?? "claude") as HarnessSlug,
  );

  useEffect(() => {
    backend
      ?.listModels()
      .then(setModels)
      .catch(() => {
        /* optional; the model field stays free-text */
      });
  }, [backend]);

  // Load the existing comparison once the catalog is ready to accept a
  // preselected case (edit mode only).
  useEffect(() => {
    if (!editing || !id || !backend?.getComparison || !token) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    backend
      .getComparison(id, token)
      .then((c: Comparison) => {
        if (!active) return;
        setName(c.name);
        setDescription(c.description);
        sel.setSlug(c.config.controls.caseSlug);
        sel.setVersion(c.config.controls.version);
        sel.setVariant(c.config.controls.variant);
        setModelId(c.config.controls.modelId ?? "");
        setAuthMode(c.config.controls.authMode);
        setVaried(c.config.varied);
        setN(c.config.n);
        setArms(c.config.arms);
        const pinned = c.config.arms.find((a) => a.harnessSlug)?.harnessSlug;
        if (pinned && c.config.varied === "model") setPinnedHarness(pinned);
        setLoading(false);
      })
      .catch((e) => {
        if (!active) return;
        setError(String(e));
        setLoading(false);
      });
    return () => {
      active = false;
    };
    // sel's setters are stable across renders; only re-run when the identity of
    // what we're loading changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, id, backend, token]);

  // Switching the varied dimension starts the arm list over — an arm's shape
  // (which of harnessSlug/ggConfigId/modelId it carries) is meaningless under a
  // different dimension, so carrying old arms across would silently mislabel
  // them.
  function onVariedChange(next: VariedDimension) {
    setVaried(next);
    setArms([]);
  }

  function toggleHarnessArm(slug: HarnessSlug) {
    setArms((prev) => {
      const exists = prev.some((a) => a.harnessSlug === slug);
      if (exists) return prev.filter((a) => a.harnessSlug !== slug);
      return [
        ...prev,
        { id: newArmId(), label: harnessName(slug), harnessSlug: slug },
      ];
    });
  }

  function toggleGgConfigArm(configId: string, configName: string) {
    setArms((prev) => {
      const exists = prev.some((a) => a.ggConfigId === configId);
      if (exists) return prev.filter((a) => a.ggConfigId !== configId);
      return [
        ...prev,
        { id: newArmId(), label: configName, ggConfigId: configId },
      ];
    });
  }

  const [addModelId, setAddModelId] = useState("");
  function addModelArm() {
    const value = addModelId.trim();
    if (!value) return;
    if (arms.some((a) => a.modelId === value)) {
      setAddModelId("");
      return;
    }
    setArms((prev) => [
      ...prev,
      {
        id: newArmId(),
        label: value,
        modelId: value,
        // See the module doc: threaded through so the launch math can read it
        // back for a model-varied comparison, even though only `modelId` is
        // meaningful under this dimension.
        harnessSlug: pinnedHarness,
      },
    ]);
    setAddModelId("");
  }
  function removeArm(armId: string) {
    setArms((prev) => prev.filter((a) => a.id !== armId));
  }

  // Re-pin every existing model arm's carried harness when the pinned harness
  // changes, so the two never disagree once runs are launched.
  function onPinnedHarnessChange(next: HarnessSlug) {
    setPinnedHarness(next);
    setArms((prev) => prev.map((a) => ({ ...a, harnessSlug: next })));
  }

  const savable =
    name.trim().length > 0 &&
    Boolean(sel.slug && sel.version && sel.variant) &&
    (varied === "model" || modelId.trim().length > 0) &&
    arms.length > 0 &&
    n >= 1;

  async function onSave() {
    if (!token || !savable) return;
    const input: ComparisonInput = {
      name: name.trim(),
      description: description.trim(),
      config: {
        controls: {
          caseSlug: sel.slug,
          version: sel.version,
          variant: sel.variant,
          ...(varied === "model" ? {} : { modelId: modelId.trim() }),
          authMode,
          orchestratorSlug: DEFAULT_ORCHESTRATOR_SLUG,
        },
        varied,
        arms,
        n,
      },
    };
    setBusy(true);
    setError(null);
    try {
      if (editing && id && backend?.updateComparison) {
        await backend.updateComparison(id, input, token);
        navigate(routes.comparisonDetail(id));
      } else if (backend?.createComparison) {
        const created = await backend.createComparison(input, token);
        navigate(routes.comparisonDetail(created.id));
      }
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <PageLayout>
        <header className={styles.detailHeader}>
          <div className={styles.detailTitleRow}>
            <BackChevron
              to={routes.runsComparisons()}
              label="All comparisons"
            />
            <h1 className={styles.detailTitle}>
              {editing ? "Comparison" : "New comparison"}
            </h1>
          </div>
        </header>
        <p className={`${exec.notice} ${exec.warn}`}>
          Sign in to create or edit a comparison — they are saved to your
          account.
        </p>
      </PageLayout>
    );
  }

  const versions = [
    ...(sel.cases.find((c) => c.slug === sel.slug)?.versions ?? []),
  ].reverse();

  return (
    <PageLayout>
      <header className={styles.detailHeader}>
        <div className={styles.detailTitleRow}>
          <BackChevron to={routes.runsComparisons()} label="All comparisons" />
          <h1 className={styles.detailTitle}>
            {editing ? name || "Comparison" : "New comparison"}
          </h1>
        </div>
      </header>

      {error && <p className={`${exec.notice} ${exec.error}`}>{error}</p>}

      {loading ? (
        <LoadingState label="Loading…" />
      ) : (
        <section className={styles.editor}>
          <label className={styles.nameField}>
            <span className={exec.fieldLabel}>Name</span>
            <input
              className={exec.input}
              type="text"
              value={name}
              placeholder="e.g. Carom — harness A/B"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className={styles.nameField}>
            <span className={exec.fieldLabel}>Description</span>
            <input
              className={exec.input}
              type="text"
              value={description}
              placeholder="What is being compared and why"
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>

          <p className={exec.sectionLabel}>Held-constant controls</p>
          <div className={exec.fields}>
            <label className={exec.field}>
              <span className={exec.fieldLabel}>Test case</span>
              <select
                className={exec.select}
                value={sel.slug}
                onChange={(e) => sel.setSlug(e.target.value)}
              >
                {[...sel.cases]
                  .sort((a, b) =>
                    testCaseName(a.slug).localeCompare(testCaseName(b.slug)),
                  )
                  .map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {testCaseName(c.slug)}
                    </option>
                  ))}
              </select>
            </label>
            <label className={exec.field}>
              <span className={exec.fieldLabel}>Version</span>
              <select
                className={exec.select}
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
            <label className={exec.field}>
              <span className={exec.fieldLabel}>Variant</span>
              <select
                className={exec.select}
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
            {varied !== "model" && (
              <label className={`${exec.field} ${exec.comboFieldWide}`}>
                <span className={exec.fieldLabel}>Model</span>
                <ModelCombobox
                  value={modelId}
                  onChange={setModelId}
                  models={models}
                  harnessFamily={familyOf(arms[0]?.harnessSlug ?? "")}
                  inputClassName={exec.input}
                  placeholder="model id (e.g. claude-opus-4-8)"
                />
              </label>
            )}
            {varied === "model" && (
              <label className={exec.field}>
                <span className={exec.fieldLabel}>Harness (held constant)</span>
                <select
                  className={exec.select}
                  value={pinnedHarness}
                  onChange={(e) =>
                    onPinnedHarnessChange(e.target.value as HarnessSlug)
                  }
                >
                  {harnesses.map((h) => (
                    <option key={h.slug} value={h.slug}>
                      {h.displayName}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className={exec.field}>
              <span className={exec.fieldLabel}>Auth mode</span>
              <SegmentedControl
                options={AUTH_MODE_OPTIONS}
                value={authMode}
                onChange={setAuthMode}
                ariaLabel="Auth mode"
              />
            </label>
            <label className={exec.field}>
              <span className={exec.fieldLabel}>N (runs per arm)</span>
              <input
                className={exec.input}
                type="number"
                min={1}
                max={50}
                step={1}
                value={n}
                onChange={(e) => {
                  const next = Math.floor(Number(e.target.value));
                  setN(
                    Number.isFinite(next) && next >= 1 ? Math.min(next, 50) : 1,
                  );
                }}
              />
            </label>
          </div>

          <p className={exec.sectionLabel}>Varied dimension</p>
          <SegmentedControl
            options={VARIED_OPTIONS}
            value={varied}
            onChange={onVariedChange}
            ariaLabel="Varied dimension"
          />

          <p className={exec.sectionLabel}>Arms</p>
          {varied === "harness" && (
            <div className={styles.armPicks}>
              {harnesses.map((h) => {
                const on = arms.some((a) => a.harnessSlug === h.slug);
                return (
                  <button
                    key={h.slug}
                    type="button"
                    className={`${styles.armPick} ${on ? styles.armPickOn : ""}`}
                    aria-pressed={on}
                    onClick={() => toggleHarnessArm(h.slug as HarnessSlug)}
                  >
                    {h.displayName}
                  </button>
                );
              })}
            </div>
          )}
          {varied === "gg_config" && (
            <>
              {ggConfigs.length === 0 ? (
                <p className={styles.empty}>
                  No saved gg configurations yet — register one on the account
                  section&rsquo;s gg tab first (a built-in configuration has no
                  stable id to compare against, so only saved configurations can
                  be an arm).
                </p>
              ) : (
                <div className={styles.armPicks}>
                  {ggConfigs.map((c) => {
                    const on = arms.some((a) => a.ggConfigId === c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        className={`${styles.armPick} ${on ? styles.armPickOn : ""}`}
                        aria-pressed={on}
                        onClick={() => toggleGgConfigArm(c.id, c.name)}
                      >
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
          {varied === "model" && (
            <>
              {arms.length > 0 && (
                <ul className={styles.chipList}>
                  {arms.map((a) => (
                    <li key={a.id} className={styles.chip}>
                      <span>{a.modelId}</span>
                      <button
                        type="button"
                        className={styles.chipRemove}
                        aria-label="Remove model arm"
                        onClick={() => removeArm(a.id)}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className={exec.fields}>
                <label className={`${exec.field} ${exec.comboFieldWide}`}>
                  <span className={exec.fieldLabel}>Add a model</span>
                  <ModelCombobox
                    value={addModelId}
                    onChange={setAddModelId}
                    models={models}
                    harnessFamily={familyOf(pinnedHarness)}
                    excludeIds={arms
                      .map((a) => a.modelId)
                      .filter((m): m is string => Boolean(m))}
                    inputClassName={exec.input}
                    placeholder="model id (e.g. gpt-5)"
                  />
                </label>
                <button
                  type="button"
                  className={exec.secondary}
                  onClick={addModelArm}
                  disabled={!addModelId.trim()}
                >
                  + Add
                </button>
              </div>
            </>
          )}
          {varied !== "model" && arms.length > 0 && (
            <ul className={styles.chipList}>
              {arms.map((a) => (
                <li key={a.id} className={styles.chip}>
                  <span>{a.label}</span>
                  <button
                    type="button"
                    className={styles.chipRemove}
                    aria-label="Remove arm"
                    onClick={() => removeArm(a.id)}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className={styles.editorActions}>
            <button
              type="button"
              className={exec.primary}
              disabled={busy || !savable}
              onClick={onSave}
            >
              {busy
                ? "Saving…"
                : editing
                  ? "Save comparison"
                  : "Create comparison"}
            </button>
            <button
              type="button"
              className={exec.secondary}
              disabled={busy}
              onClick={() =>
                navigate(
                  editing && id
                    ? routes.comparisonDetail(id)
                    : routes.runsComparisons(),
                )
              }
            >
              Cancel
            </button>
          </div>
        </section>
      )}
    </PageLayout>
  );
}
