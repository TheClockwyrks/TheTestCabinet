import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import type { HarnessSlug } from "@test-cabinet/run-record";
import type {
  Comparison,
  ComparisonArm,
  ComparisonInput,
} from "@test-cabinet/run-record/comparison";
import { useAuth } from "../../../client/auth";
import { useBackend } from "../../../client/context";
import type { Model } from "../../../client/types";
import { PageLayout } from "../../components/PageLayout";
import { LoadingState } from "../../components/LoadingState";
import { BackChevron } from "../../components/BackChevron";
import { ModelCombobox } from "../../components/ModelCombobox";
import { harnesses } from "../../data/harnesses";
import { familyOf } from "../../data/families";
import { DEFAULT_ENGINE_SLUG } from "../../data/engines";
import { DEFAULT_ORCHESTRATOR_SLUG } from "../../data/orchestrators";
import {
  CATALOG_CATEGORIES,
  type CatalogCategory,
} from "../../data/testCaseTabs";
import { useCatalog } from "../../runtime/useCatalog";
import { useCaseCategory } from "../../runtime/useCaseCategory";
import { useTestCaseName } from "../../data/useTestCaseName";
import { launchModelSlots } from "../runs/gg/ggConfigDraft";
import { useGgConfigs } from "../runs/gg/useGgConfigs";
import { routes } from "../../routes";
import { armLabel, type ArmDraft, type ArmKind } from "./armDraft";
import exec from "../runs/RunExec.module.scss";
import styles from "./Comparisons.module.scss";

// A locally-unique arm id (never sent anywhere but the comparison's own config,
// so a `crypto.randomUUID` — falling back to a timestamp+random string on a host
// without it — is exactly as stable as the contract asks for).
function newArmId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `arm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function emptyArm(kind: ArmKind): ArmDraft {
  return {
    id: newArmId(),
    kind,
    label: "",
    harness: (harnesses[0]?.slug ?? "claude") as HarnessSlug,
    modelId: "",
    ggConfig: "",
    slotModels: {},
    runIds: [],
  };
}

// The comparison create/edit form (`/comparisons/new`, `/comparisons/:id/edit`):
// the test every arm runs (type → case → version → variant, the same split the
// new-run form uses), `N`, and then the **configurations** being compared — two
// or more, each either a third-party harness on a model or a gg configuration
// with a model bound to every slot it declares. That mix is the point: a gg
// configuration is compared head-to-head against a harness, and two gg
// configurations against each other, in the one experiment.
//
// The model is per configuration, never a global control — comparing a harness
// against gg means comparing what each actually runs, and a gg configuration can
// span several models (one per agent role) so it has no single model to pin. The
// auth mode is likewise not asked for: it comes from the harness's own
// configuration, and drift across an arm's runs surfaces as a confound on the
// detail page rather than being declared here.
//
// Console-only; gated on a signed-in account (a comparison, like a coverage plan
// or a gg configuration, is per-account).
export function ComparisonEditPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const { token } = useAuth();
  const { client: backend } = useBackend();
  const navigate = useNavigate();
  const testCaseName = useTestCaseName();
  const sel = useCatalog();
  const { options: ggOptions } = useGgConfigs();

  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(editing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [n, setN] = useState(3);
  const [arms, setArms] = useState<ArmDraft[]>(() => [
    // A new comparison opens on the shape the feature exists for: one harness
    // against one gg configuration. Both rows still need their model picked.
    emptyArm("harness"),
    emptyArm("gg"),
  ]);
  // The case an edited comparison already names, so the type selector opens on
  // that case's type instead of resetting the selection to the default type.
  const [loadedSlug, setLoadedSlug] = useState<string | null>(null);
  const {
    category,
    setCategory,
    cases: sortedCases,
  } = useCaseCategory(sel, { navSlug: loadedSlug, ready: !loading });

  useEffect(() => {
    backend
      ?.listModels()
      .then(setModels)
      .catch(() => {
        /* optional; the model fields stay free-text */
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
        setLoadedSlug(c.config.controls.caseSlug);
        setN(c.config.n);
        setArms(c.config.arms.map(draftFromArm));
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

  // The gg configuration a row launches, and the model slots it still needs
  // bound — the deferred slots its agents name. Read straight off the picked
  // option, exactly as the new-run form does.
  const ggOptionFor = (key: string) => ggOptions.find((o) => o.key === key);
  const ggSlotsFor = (key: string) => {
    const set = ggOptionFor(key)?.capabilitySet;
    return set ? launchModelSlots(set) : [];
  };
  // A row's slot models seeded from the configuration's declared defaults, so
  // picking a configuration that names its models opens ready to run.
  const defaultSlotModels = (key: string): Record<string, string> =>
    Object.fromEntries(
      ggSlotsFor(key).map((slot) => [slot.name, slot.defaultModelId ?? ""]),
    );

  // Seed every gg row's configuration once the configurations have loaded, so a
  // fresh row opens on a launchable default rather than a blank picker.
  useEffect(() => {
    if (ggOptions.length === 0) return;
    const first = ggOptions[0]!;
    const seeded = Object.fromEntries(
      launchModelSlots(first.capabilitySet).map((slot) => [
        slot.name,
        slot.defaultModelId ?? "",
      ]),
    );
    setArms((prev) =>
      prev.some((a) => a.kind === "gg" && !a.ggConfig)
        ? prev.map((a) =>
            a.kind === "gg" && !a.ggConfig
              ? { ...a, ggConfig: first.key, slotModels: { ...seeded } }
              : a,
          )
        : prev,
    );
  }, [ggOptions]);

  function updateArm(armId: string, patch: Partial<ArmDraft>) {
    setArms((prev) =>
      prev.map((a) => (a.id === armId ? { ...a, ...patch } : a)),
    );
  }
  // Switching a row between a harness and a gg configuration keeps nothing but
  // the operator's own label: a harness row's model and a gg row's slot bindings
  // describe different things, and carrying either across would bind a model to
  // something that never asked for it.
  function setArmKind(armId: string, kind: ArmKind) {
    setArms((prev) =>
      prev.map((a) =>
        a.id === armId
          ? {
              ...emptyArm(kind),
              id: a.id,
              label: a.label,
              runIds: a.runIds,
              ...(kind === "gg" && ggOptions[0]
                ? {
                    ggConfig: ggOptions[0].key,
                    slotModels: defaultSlotModels(ggOptions[0].key),
                  }
                : {}),
            }
          : a,
      ),
    );
  }
  // Switching a row's configuration re-seeds its slot models: the slots a
  // configuration declares are its own, so carrying the previous one's picks over
  // would bind models to slots that no longer exist (and silently drop the ones
  // that do).
  function setGgConfig(armId: string, key: string) {
    updateArm(armId, { ggConfig: key, slotModels: defaultSlotModels(key) });
  }
  function setSlotModel(armId: string, slot: string, modelId: string) {
    setArms((prev) =>
      prev.map((a) =>
        a.id === armId
          ? { ...a, slotModels: { ...a.slotModels, [slot]: modelId } }
          : a,
      ),
    );
  }
  function addArm() {
    setArms((prev) => {
      // Carry the last row's kind forward — fanning out across models of one
      // harness (or one gg configuration) is the common case — but never its
      // model, which stays an explicit pick.
      const last = prev[prev.length - 1];
      const kind: ArmKind = last?.kind ?? "harness";
      const next = emptyArm(kind);
      if (kind === "harness" && last) next.harness = last.harness;
      if (kind === "gg" && last?.ggConfig) {
        next.ggConfig = last.ggConfig;
        next.slotModels = defaultSlotModels(last.ggConfig);
      }
      return [...prev, next];
    });
  }
  function removeArm(armId: string) {
    setArms((prev) => prev.filter((a) => a.id !== armId));
  }

  const ggName = (key: string) => ggOptionFor(key)?.name ?? "gg";
  const derivedLabel = (arm: ArmDraft) => armLabel(arm, ggName);

  // A row is launchable when its configuration is fully specified: a harness row
  // needs its model, a gg row a configuration this operator can still reach and a
  // model for every slot that configuration defers. A partially-filled row (or one
  // naming a configuration that has since been deleted) would be rejected at
  // launch, long after the operator left this form.
  const armReady = (arm: ArmDraft) =>
    arm.kind === "harness"
      ? Boolean(arm.harness && arm.modelId.trim())
      : Boolean(ggOptionFor(arm.ggConfig)) &&
        ggSlotsFor(arm.ggConfig).every((slot) =>
          (arm.slotModels[slot.name] ?? "").trim(),
        );

  const savable =
    name.trim().length > 0 &&
    Boolean(sel.slug && sel.version && sel.variant) &&
    arms.length >= 2 &&
    arms.every(armReady) &&
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
          orchestratorSlug: DEFAULT_ORCHESTRATOR_SLUG,
          engineSlug: DEFAULT_ENGINE_SLUG,
        },
        arms: arms.map((arm) => armFromDraft(arm, derivedLabel(arm))),
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

  // Catalog versions are oldest-first; show the dropdown newest-first.
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
              placeholder="e.g. Carom — gg vs Pi"
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

          <p className={exec.sectionLabel}>The test every arm runs</p>
          <div className={exec.fields}>
            <label className={exec.field}>
              <span className={exec.fieldLabel}>Test case type</span>
              <select
                className={exec.select}
                value={category}
                onChange={(e) => setCategory(e.target.value as CatalogCategory)}
              >
                {CATALOG_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={exec.field}>
              <span className={exec.fieldLabel}>Test case</span>
              <select
                className={exec.select}
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

          <p className={exec.sectionLabel}>Configurations compared</p>
          <div className={exec.comboList}>
            {arms.map((arm) => (
              <div key={arm.id} className={exec.comboRow}>
                <label className={`${exec.field} ${exec.comboField}`}>
                  <span className={exec.fieldLabel}>Kind</span>
                  <select
                    className={exec.select}
                    value={arm.kind}
                    onChange={(e) =>
                      setArmKind(arm.id, e.target.value as ArmKind)
                    }
                  >
                    <option value="harness">Harness</option>
                    <option value="gg">gg configuration</option>
                  </select>
                </label>
                {arm.kind === "harness" ? (
                  <>
                    <label className={`${exec.field} ${exec.comboField}`}>
                      <span className={exec.fieldLabel}>Harness</span>
                      <select
                        className={exec.select}
                        value={arm.harness}
                        onChange={(e) =>
                          // A model slug is family-specific, so switching harness
                          // clears the model: the operator picks one the new
                          // harness can actually launch.
                          updateArm(arm.id, {
                            harness: e.target.value,
                            modelId: "",
                          })
                        }
                      >
                        {harnesses.map((h) => (
                          <option key={h.slug} value={h.slug}>
                            {h.displayName}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={`${exec.field} ${exec.comboFieldWide}`}>
                      <span className={exec.fieldLabel}>Model</span>
                      <ModelCombobox
                        value={arm.modelId}
                        onChange={(v) => updateArm(arm.id, { modelId: v })}
                        models={models}
                        harnessFamily={familyOf(arm.harness)}
                        inputClassName={exec.input}
                        placeholder="model id (e.g. claude-opus-4-8)"
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <label className={`${exec.field} ${exec.comboField}`}>
                      <span className={exec.fieldLabel}>gg configuration</span>
                      <select
                        className={exec.select}
                        value={arm.ggConfig}
                        onChange={(e) => setGgConfig(arm.id, e.target.value)}
                        title={ggOptionFor(arm.ggConfig)?.description}
                      >
                        {ggOptions.length === 0 && (
                          <option value="">(loading…)</option>
                        )}
                        {/* A saved comparison can name a configuration that has
                            since been deleted (or belongs to another account).
                            Show it as itself rather than letting the select fall
                            silently onto the first option. */}
                        {arm.ggConfig && !ggOptionFor(arm.ggConfig) && (
                          <option value={arm.ggConfig}>
                            {arm.ggConfig} (unavailable)
                          </option>
                        )}
                        {ggOptions.map((o) => (
                          <option
                            key={o.key}
                            value={o.key}
                            title={o.description}
                          >
                            {o.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {/* One picker per model slot the chosen configuration
                        declares, in declaration order, pre-filled with that
                        slot's default. gg reaches every slot's model through
                        OpenRouter, so each is scoped to that family. */}
                    {ggSlotsFor(arm.ggConfig).map((slot) => (
                      <label
                        key={slot.name}
                        className={`${exec.field} ${exec.comboFieldWide}`}
                      >
                        <span className={exec.fieldLabel}>{slot.name}</span>
                        <ModelCombobox
                          value={arm.slotModels[slot.name] ?? ""}
                          onChange={(v) => setSlotModel(arm.id, slot.name, v)}
                          models={models}
                          harnessFamily={familyOf("gg")}
                          inputClassName={exec.input}
                          placeholder="model id (e.g. anthropic/claude-opus-4.8)"
                        />
                      </label>
                    ))}
                  </>
                )}
                <label className={`${exec.field} ${exec.comboField}`}>
                  <span className={exec.fieldLabel}>Label (optional)</span>
                  <input
                    className={exec.input}
                    type="text"
                    value={arm.label}
                    placeholder={derivedLabel(arm)}
                    onChange={(e) =>
                      updateArm(arm.id, { label: e.target.value })
                    }
                  />
                </label>
                <button
                  type="button"
                  className={exec.comboRemove}
                  onClick={() => removeArm(arm.id)}
                  disabled={arms.length <= 2}
                  aria-label="Remove configuration"
                  title={
                    arms.length <= 2
                      ? "A comparison needs at least two configurations"
                      : "Remove configuration"
                  }
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button type="button" className={exec.secondary} onClick={addArm}>
            + Add configuration
          </button>

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
            {!savable && (
              <span className={styles.empty}>
                Name the comparison, pick its test, and give every configuration
                its model — at least two.
              </span>
            )}
          </div>
        </section>
      )}
    </PageLayout>
  );
}

/** The stored arm a row saves as. The run ids are carried through untouched: an
 *  edit that only renames an arm (or corrects its model) must not orphan the runs
 *  already launched for it — and a configuration edited out from under its runs
 *  surfaces on the detail page as a confound rather than silently. */
function armFromDraft(arm: ArmDraft, label: string): ComparisonArm {
  const base = {
    id: arm.id,
    label: arm.label.trim() || label,
    ...(arm.runIds.length > 0 ? { runIds: arm.runIds } : {}),
  };
  if (arm.kind === "harness") {
    return {
      ...base,
      harnessSlug: arm.harness as HarnessSlug,
      modelId: arm.modelId.trim(),
    };
  }
  return {
    ...base,
    ggConfigId: arm.ggConfig,
    ggSlotModels: Object.fromEntries(
      Object.entries(arm.slotModels).map(([slot, model]) => [
        slot,
        model.trim(),
      ]),
    ),
  };
}

/** The editable row a stored arm mounts as. */
function draftFromArm(arm: ComparisonArm): ArmDraft {
  const gg = Boolean(arm.ggConfigId);
  return {
    id: arm.id,
    kind: gg ? "gg" : "harness",
    label: arm.label,
    harness:
      arm.harnessSlug ?? ((harnesses[0]?.slug ?? "claude") as HarnessSlug),
    modelId: arm.modelId ?? "",
    ggConfig: arm.ggConfigId ?? "",
    slotModels: { ...(arm.ggSlotModels ?? {}) },
    runIds: arm.runIds ?? [],
  };
}
