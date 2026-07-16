import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import type {
  ReviewPlan,
  ReviewPlanCombo,
} from "@test-cabinet/run-record/review-plan";
import { useAuth } from "../../../client/auth";
import { useBackend } from "../../../client/context";
import type { Model } from "../../../client/types";
import { harnesses } from "../../data/harnesses";
import { familyOf, modelForHarness } from "../../data/families";
import {
  OPENROUTER_PROVIDER,
  PROVIDERS,
  harnessUsesProvider,
} from "../../data/providers";
import { CATALOG_TABS, tabLabel, tabOf } from "../../data/testCaseTabs";
import { useTestCases } from "../../data/useTestCases";
import { ModelCombobox } from "../../components/ModelCombobox";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { useCatalog } from "../../runtime/useCatalog";
import { useTestCaseName } from "../../data/useTestCaseName";
import { routes } from "../../routes";
import type { CatalogTab } from "../../routes";
import exec from "./RunExec.module.scss";
import styles from "./Coverage.module.scss";

const EMPTY_PLAN: ReviewPlan = {
  runsPerCell: 3,
  cases: [],
  combinations: [],
};

// The review-plan editor, its own page (`/runs/coverage/config`). It loads the
// saved plan and the model catalog, lets a reviewer edit the runs-per-cell
// target, the harness/model combinations, and the version-pinned cases, then
// persists on Save and returns to the coverage dashboard. Like the dashboard it
// is gated on a signed-in reviewer (the plan is per-account); console-only.
export function CoverageConfigPage() {
  const { token } = useAuth();
  const { client: backend } = useBackend();
  const navigate = useNavigate();
  const testCaseName = useTestCaseName();

  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The editable plan fields, hydrated from the saved plan once it loads.
  const [runsPerCell, setRunsPerCell] = useState(1);
  const [cases, setCases] = useState<ReviewPlan["cases"]>([]);
  const [combinations, setCombinations] = useState<ReviewPlan["combinations"]>(
    [],
  );

  // The add-a-combination picker.
  const [addHarness, setAddHarness] = useState(harnesses[0]?.slug ?? "");
  const [addModel, setAddModel] = useState("");
  const [addProvider, setAddProvider] = useState(OPENROUTER_PROVIDER);

  // The add-a-case picker reuses the catalog cursor (case → version → variant).
  const sel = useCatalog();

  // The full catalog, so a declared case can be filed under the same category
  // tab the `/test-cases` page groups it under.
  const { testCases } = useTestCases();
  const tabForSlug = useCallback(
    (slug: string): CatalogTab | null => {
      const tc = testCases.find((c) => c.slug === slug);
      return tc ? tabOf(tc) : null;
    },
    [testCases],
  );

  // The catalog arrives in slug order, but the dropdown labels each option with
  // the display name — so sort by resolved display name to keep the list
  // alphabetical as shown (otherwise e.g. "Carom" slots in where "pong" sits).
  const sortedCases = useMemo(
    () =>
      [...sel.cases].sort((a, b) =>
        testCaseName(a.slug).localeCompare(testCaseName(b.slug)),
      ),
    [sel.cases, testCaseName],
  );

  // Load the plan and the model catalog once signed in. The catalog feeds the
  // model picker (same source as the new-run form).
  useEffect(() => {
    if (!backend || !token) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    Promise.resolve(
      backend.getReviewPlan?.(token) ?? Promise.resolve(EMPTY_PLAN),
    )
      .then((plan) => {
        if (!active) return;
        const p = plan ?? EMPTY_PLAN;
        setRunsPerCell(Math.max(1, p.runsPerCell || 1));
        setCases(p.cases);
        setCombinations(p.combinations);
        setLoading(false);
      })
      .catch((e) => {
        if (!active) return;
        setError(String(e));
        setLoading(false);
      });
    backend
      .listModels()
      .then((ms) => active && setModels(ms))
      .catch(() => {
        /* optional; the model field stays free-text */
      });
    return () => {
      active = false;
    };
  }, [backend, token]);

  const harnessName = (slug: string) =>
    harnesses.find((h) => h.slug === slug)?.displayName ?? slug;

  // Combination pills grouped under their harness (in catalog order), each pill
  // carrying its original index so removal still targets the right entry after
  // grouping and sorting. Within a harness the pills sort alphabetically by model
  // (then provider), and empty harnesses drop out. Any unknown harness slug the
  // saved plan carries is kept in its own trailing group so no pill is lost.
  const comboGroups = useMemo(() => {
    const indexed = combinations.map((combo, i) => ({ combo, i }));
    const known = harnesses.map((h) => h.slug);
    const extra = indexed
      .map(({ combo }) => combo.harness)
      .filter((slug) => !known.includes(slug));
    const order = [...new Set([...known, ...extra])];
    return order
      .map((slug) => ({
        slug,
        items: indexed
          .filter(({ combo }) => combo.harness === slug)
          .sort(
            (a, b) =>
              a.combo.model.localeCompare(b.combo.model) ||
              (a.combo.provider ?? "").localeCompare(b.combo.provider ?? ""),
          ),
      }))
      .filter((group) => group.items.length > 0);
  }, [combinations]);

  // Test-case pills grouped under their catalog category tab (in tab order), each
  // pill carrying its original index. Within a tab the pills sort alphabetically
  // by display name (then variant, then version). Cases whose slug the catalog
  // doesn't know fall into a trailing "Other" group.
  const caseGroups = useMemo(() => {
    const indexed = cases.map((c, i) => ({ c, i }));
    const order: (CatalogTab | null)[] = [
      ...CATALOG_TABS.map((t) => t.tab),
      null,
    ];
    return order
      .map((tab) => ({
        tab,
        items: indexed
          .filter(({ c }) => tabForSlug(c.slug) === tab)
          .sort(
            (a, b) =>
              testCaseName(a.c.slug).localeCompare(testCaseName(b.c.slug)) ||
              a.c.variant.localeCompare(b.c.variant) ||
              a.c.version.localeCompare(b.c.version),
          ),
      }))
      .filter((group) => group.items.length > 0);
  }, [cases, tabForSlug, testCaseName]);

  function addCombination() {
    if (!addHarness || !addModel) return;
    const combo: ReviewPlanCombo = {
      harness: addHarness as ReviewPlanCombo["harness"],
      model: addModel,
      ...(harnessUsesProvider(addHarness) ? { provider: addProvider } : {}),
    };
    setCombinations((prev) => [...prev, combo]);
    setAddModel("");
  }

  function addCase() {
    if (!sel.slug || !sel.version || !sel.variant) return;
    // Skip an exact duplicate so the same cell is not declared twice.
    setCases((prev) =>
      prev.some(
        (c) =>
          c.slug === sel.slug &&
          c.version === sel.version &&
          c.variant === sel.variant,
      )
        ? prev
        : [
            ...prev,
            { slug: sel.slug, version: sel.version, variant: sel.variant },
          ],
    );
  }

  // A plan is only savable once it declares at least one combination and one
  // case — anything less is not a coverage plan, just an empty form, and saving
  // it would leave the dashboard reporting the plan as empty.
  const savable = combinations.length > 0 && cases.length > 0;

  async function onSave() {
    if (!backend?.putReviewPlan || !token || !savable) return;
    setBusy(true);
    setError(null);
    try {
      await backend.putReviewPlan({ runsPerCell, cases, combinations }, token);
      navigate(routes.runCoverage());
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  // Clear the saved plan entirely, back to the empty state. Guarded behind a
  // confirmation since it discards every declared combination and case.
  async function onReset() {
    if (!backend?.putReviewPlan || !token) return;
    if (
      !window.confirm(
        "Reset your review plan? This clears every declared combination and " +
          "case. This cannot be undone.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await backend.putReviewPlan(EMPTY_PLAN, token);
      navigate(routes.runCoverage());
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  // Catalog versions are oldest-first; show the dropdown newest-first.
  const versions = [
    ...(sel.cases.find((c) => c.slug === sel.slug)?.versions ?? []),
  ].reverse();

  if (!token) {
    return (
      <PageLayout>
        <PromptHeader
          command="--runs/coverage/config"
          comment={<>// review plan</>}
        />
        <p className={`${exec.notice} ${exec.warn}`}>
          Sign in to edit your review plan — it is saved to your account. Use
          the account control in the top bar to register or log in.
        </p>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <PromptHeader
        command="--runs/coverage/config"
        comment={<>// declare the cases and combinations to cover</>}
      />

      {error && <p className={`${exec.notice} ${exec.error}`}>{error}</p>}

      {loading ? (
        <p className={styles.empty}>Loading plan…</p>
      ) : (
        <section className={styles.editor}>
          <label className={exec.runCountField}>
            <span className={exec.fieldLabel}>Runs per cell</span>
            <input
              className={exec.input}
              type="number"
              min={1}
              max={100}
              step={1}
              value={runsPerCell}
              onChange={(e) => {
                const n = Math.floor(Number(e.target.value));
                setRunsPerCell(
                  Number.isFinite(n) && n >= 1 ? Math.min(n, 100) : 1,
                );
              }}
            />
          </label>

          <p className={exec.sectionLabel}>Harness / model combinations</p>
          {comboGroups.length > 0 && (
            <div className={styles.chipGroups}>
              {comboGroups.map((group) => (
                <div key={group.slug} className={styles.chipGroup}>
                  <div className={styles.chipGroupHead}>
                    <span className={styles.chipGroupTitle}>
                      {harnessName(group.slug)}
                    </span>
                    <button
                      type="button"
                      className={styles.chipGroupClear}
                      onClick={() =>
                        setCombinations((prev) =>
                          prev.filter((c) => c.harness !== group.slug),
                        )
                      }
                    >
                      Clear all
                    </button>
                  </div>
                  <ul className={styles.chipList}>
                    {group.items.map(({ combo, i }) => (
                      <li
                        key={`${combo.harness}:${combo.model}:${i}`}
                        className={styles.chip}
                      >
                        <span>
                          {combo.model}
                          {combo.provider ? ` · ${combo.provider}` : ""}
                        </span>
                        <button
                          type="button"
                          className={styles.chipRemove}
                          aria-label="Remove combination"
                          onClick={() =>
                            setCombinations((prev) =>
                              prev.filter((_, j) => j !== i),
                            )
                          }
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          <div className={styles.inputRow}>
            <label className={`${exec.field} ${exec.comboField}`}>
              <span className={exec.fieldLabel}>Harness</span>
              <select
                className={exec.select}
                value={addHarness}
                onChange={(e) => {
                  const next = e.target.value;
                  // Remap the pending model to the new harness's family, so a
                  // slug the new harness can't launch isn't silently carried over.
                  setAddModel((m) => modelForHarness(models, m, next));
                  setAddHarness(next);
                }}
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
                value={addModel}
                onChange={setAddModel}
                models={models}
                harnessFamily={familyOf(addHarness)}
                inputClassName={exec.input}
                placeholder="model id (e.g. claude-opus-4-8)"
              />
            </label>
            {harnessUsesProvider(addHarness) && (
              <label className={`${exec.field} ${exec.comboField}`}>
                <span className={exec.fieldLabel}>Provider</span>
                <select
                  className={exec.select}
                  value={addProvider}
                  onChange={(e) => setAddProvider(e.target.value)}
                >
                  {PROVIDERS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="button"
              className={exec.secondary}
              onClick={addCombination}
              disabled={!addHarness || !addModel}
            >
              + Add
            </button>
          </div>

          <p className={exec.sectionLabel}>Test cases</p>
          {caseGroups.length > 0 && (
            <div className={styles.chipGroups}>
              {caseGroups.map((group) => (
                <div key={group.tab ?? "other"} className={styles.chipGroup}>
                  <div className={styles.chipGroupHead}>
                    <span className={styles.chipGroupTitle}>
                      {group.tab ? tabLabel(group.tab) : "Other"}
                    </span>
                    <button
                      type="button"
                      className={styles.chipGroupClear}
                      onClick={() =>
                        setCases((prev) =>
                          prev.filter((c) => tabForSlug(c.slug) !== group.tab),
                        )
                      }
                    >
                      Clear all
                    </button>
                  </div>
                  <ul className={styles.chipList}>
                    {group.items.map(({ c, i }) => (
                      <li
                        key={`${c.slug}@${c.version}@${c.variant}`}
                        className={styles.chip}
                      >
                        <span>
                          {testCaseName(c.slug)} · {c.variant} · {c.version}
                        </span>
                        <button
                          type="button"
                          className={styles.chipRemove}
                          aria-label="Remove case"
                          onClick={() =>
                            setCases((prev) => prev.filter((_, j) => j !== i))
                          }
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          <div className={styles.inputRow}>
            <label className={`${exec.field} ${exec.comboField}`}>
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
            <label className={`${exec.field} ${exec.comboField}`}>
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
            <label className={`${exec.field} ${exec.comboField}`}>
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
            <button
              type="button"
              className={exec.secondary}
              onClick={addCase}
              disabled={!sel.slug || !sel.version || !sel.variant}
            >
              + Add
            </button>
          </div>

          <div className={styles.editorActions}>
            <button
              type="button"
              className={exec.primary}
              disabled={busy || !savable}
              onClick={onSave}
            >
              {busy ? "Saving…" : "Save plan"}
            </button>
            <button
              type="button"
              className={exec.secondary}
              disabled={busy}
              onClick={() => navigate(routes.runCoverage())}
            >
              Cancel
            </button>
            <button
              type="button"
              className={exec.danger}
              disabled={busy}
              onClick={onReset}
            >
              Reset plan
            </button>
          </div>
        </section>
      )}
    </PageLayout>
  );
}
