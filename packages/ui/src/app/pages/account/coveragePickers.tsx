import { useMemo, useState } from "react";
import type {
  ReviewPlanCase,
  ReviewPlanCombo,
} from "@test-cabinet/run-record/coverage";
import type { Model } from "../../../client/types";
import { harnesses } from "../../data/harnesses";
import { familyOf, modelForHarness } from "../../data/families";
import {
  OPENROUTER_PROVIDER,
  PROVIDERS,
  harnessUsesProvider,
} from "../../data/providers";
import { CATALOG_TABS, tabLabel, tabOf } from "../../data/testCaseTabs";
import type { CatalogTab } from "../../routes";
import { useTestCases } from "../../data/useTestCases";
import { useCatalog } from "../../runtime/useCatalog";
import { useTestCaseName } from "../../data/useTestCaseName";
import { ModelCombobox } from "../../components/ModelCombobox";
import exec from "../runs/RunExec.module.scss";
import styles from "./Coverage.module.scss";

// The harness/model-combination and version-pinned-case pickers, shared by the
// coverage plan editor (its one-off members) and the group editor (a group's
// members). Each is a self-contained editor over an array: it renders the current
// entries as pills grouped by section and an add-a-row control, and reports the new
// array back through `onChange`. Lifted out of the old single-plan config page so
// the plan editor and group editor stay byte-for-byte identical.

/** Combination pills grouped under their harness, each carrying its original index
 *  so removal targets the right entry after grouping/sorting (from the old config
 *  page). Empty harnesses drop out; an unknown harness slug keeps its own group. */
function useComboGroups(combos: ReviewPlanCombo[]) {
  return useMemo(() => {
    const indexed = combos.map((combo, i) => ({ combo, i }));
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
  }, [combos]);
}

export function ComboPicker({
  combos,
  onChange,
  models,
}: {
  combos: ReviewPlanCombo[];
  onChange: (next: ReviewPlanCombo[]) => void;
  models: Model[];
}) {
  const [addHarness, setAddHarness] = useState(harnesses[0]?.slug ?? "");
  const [addModel, setAddModel] = useState("");
  const [addProvider, setAddProvider] = useState(OPENROUTER_PROVIDER);

  const comboGroups = useComboGroups(combos);

  // Models already paired with the harness/provider the add-row is pointed at.
  // Adding one again is a no-op (the entry would be de-duped below), so the
  // dropdown leaves them out. Scoped to the current harness/provider because
  // that, with the model, is what makes a combination distinct.
  const addProviderKey = harnessUsesProvider(addHarness) ? addProvider : "";
  const alreadyAdded = useMemo(
    () =>
      combos
        .filter(
          (c) =>
            c.harness === addHarness && (c.provider ?? "") === addProviderKey,
        )
        .map((c) => c.model),
    [combos, addHarness, addProviderKey],
  );

  const harnessName = (slug: string) =>
    harnesses.find((h) => h.slug === slug)?.displayName ?? slug;

  function addCombination() {
    if (!addHarness || !addModel) return;
    const combo: ReviewPlanCombo = {
      harness: addHarness as ReviewPlanCombo["harness"],
      model: addModel,
      ...(harnessUsesProvider(addHarness) ? { provider: addProvider } : {}),
    };
    // Skip an exact duplicate so the same combination is not added twice.
    if (
      combos.some(
        (c) =>
          c.harness === combo.harness &&
          c.model === combo.model &&
          (c.provider ?? "") === (combo.provider ?? ""),
      )
    ) {
      setAddModel("");
      return;
    }
    onChange([...combos, combo]);
    setAddModel("");
  }

  return (
    <>
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
                    onChange(combos.filter((c) => c.harness !== group.slug))
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
                      onClick={() => onChange(combos.filter((_, j) => j !== i))}
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
            excludeIds={alreadyAdded}
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
    </>
  );
}

export function CasePicker({
  cases,
  onChange,
}: {
  cases: ReviewPlanCase[];
  onChange: (next: ReviewPlanCase[]) => void;
}) {
  const testCaseName = useTestCaseName();
  const sel = useCatalog();
  const { testCases } = useTestCases();

  const tabForSlug = (slug: string): CatalogTab | null => {
    const tc = testCases.find((c) => c.slug === slug);
    return tc ? tabOf(tc) : null;
  };

  // The catalog arrives in slug order; sort by display name to match the labels.
  const sortedCases = useMemo(
    () =>
      [...sel.cases].sort((a, b) =>
        testCaseName(a.slug).localeCompare(testCaseName(b.slug)),
      ),
    [sel.cases, testCaseName],
  );

  // Case pills grouped under their catalog category tab, each carrying its original
  // index (from the old config page). Unknown slugs fall into a trailing "Other".
  const caseGroups = useMemo(() => {
    const indexed = cases.map((c, i) => ({ c, i }));
    const order: (CatalogTab | null)[] = [
      ...CATALOG_TABS.map((tab) => tab.tab),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cases, testCases, testCaseName]);

  function addCase() {
    if (!sel.slug || !sel.version || !sel.variant) return;
    if (
      cases.some(
        (c) =>
          c.slug === sel.slug &&
          c.version === sel.version &&
          c.variant === sel.variant,
      )
    ) {
      return;
    }
    onChange([
      ...cases,
      { slug: sel.slug, version: sel.version, variant: sel.variant },
    ]);
  }

  // Catalog versions are oldest-first; show the dropdown newest-first.
  const versions = [
    ...(sel.cases.find((c) => c.slug === sel.slug)?.versions ?? []),
  ].reverse();

  return (
    <>
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
                    onChange(cases.filter((c) => tabForSlug(c.slug) !== group.tab))
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
                      onClick={() => onChange(cases.filter((_, j) => j !== i))}
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
    </>
  );
}
