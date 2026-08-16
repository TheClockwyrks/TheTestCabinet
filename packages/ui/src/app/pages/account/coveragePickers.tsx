import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CoverageAxis,
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
import {
  CATALOG_CATEGORIES,
  categoryLabel,
  categoryOf,
  type CatalogCategory,
} from "../../data/testCaseTabs";
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
//
// It also holds the small controls over a plan's *schedule* (the ordering axis and
// the review-buffer override), which the editor renders and the dashboard has to be
// able to name — one home for them means the two surfaces can never call the same
// ordering by two different names.

/**
 * How each ordering axis is described to a reviewer.
 *
 * The wire calls them `case` and `combination`, but a reviewer is not choosing a
 * traversal — they are choosing what they will be able to compare side by side when
 * the runs land. "One case at a time" finishes every model on a case before moving
 * on (so a case's results are reviewable together); "One model at a time" walks one
 * combination through every case first (so a model's results are). The
 * depth-first/breadth-first vocabulary is deliberately absent: it describes the
 * implementation and answers none of the reviewer's question.
 */
export const AXIS_LABELS: Readonly<Record<CoverageAxis, string>> = {
  case: "One case at a time",
  combination: "One model at a time",
};

/** The longer form shown under the picker, saying what the choice buys. */
const AXIS_HINTS: Readonly<Record<CoverageAxis, string>> = {
  case: "Every model runs a case before the next case starts, so a case's runs arrive together and can be judged against each other.",
  combination:
    "One model climbs the whole case list before the next model starts, so a model's runs arrive together.",
};

/** The order runs will arrive in, named the way the console names it everywhere. */
export function axisLabel(axis: CoverageAxis): string {
  return AXIS_LABELS[axis];
}

/**
 * The ordering control: two mutually exclusive pills over {@link AXIS_LABELS}.
 *
 * The choice is real and not cosmetic — a top-up emits whole cells in this order,
 * `job.queue_seq` is monotonic, and the dispatcher claims in ascending order, so the
 * order shown here *is* the order the runs execute and therefore the order they
 * become reviewable in.
 */
export function AxisPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: CoverageAxis;
  onChange: (next: CoverageAxis) => void;
  disabled?: boolean;
}) {
  return (
    <>
      <div className={styles.kindRow} role="radiogroup" aria-label="Run order">
        {(Object.keys(AXIS_LABELS) as CoverageAxis[]).map((axis) => (
          <button
            key={axis}
            type="button"
            role="radio"
            aria-checked={value === axis}
            disabled={disabled}
            className={`${styles.groupPick} ${
              value === axis ? styles.groupPickOn : ""
            }`}
            onClick={() => onChange(axis)}
          >
            {AXIS_LABELS[axis]}
          </button>
        ))}
      </div>
      <p className={styles.fieldHint}>{AXIS_HINTS[value]}</p>
    </>
  );
}

/**
 * The plan's review-buffer override: how many runs this plan may leave outstanding
 * (in flight, or finished and unreviewed by you) before a top-up stops.
 *
 * Empty is not zero, and the field is built around that distinction: empty means
 * "no opinion — use my account default", while `0` means "never top this plan up",
 * which is a different instruction the reviewer is entitled to give. So the value is
 * a nullable number, the placeholder shows the account default that an empty field
 * inherits, and clearing the field is always available as its own control rather
 * than something you reach by deleting digits until the input happens to be blank.
 */
export function BufferTargetField({
  value,
  accountDefault,
  onChange,
}: {
  /** The plan's override, or null to inherit the account default. */
  value: number | null;
  /** The account-wide default an empty field falls back to. */
  accountDefault: number;
  onChange: (next: number | null) => void;
}) {
  return (
    <div className={styles.bufferField}>
      <label className={exec.runCountField}>
        <span className={exec.fieldLabel}>Review buffer (this plan)</span>
        <input
          className={exec.input}
          type="number"
          min={0}
          max={500}
          step={1}
          value={value ?? ""}
          placeholder={String(accountDefault)}
          onChange={(e) => {
            const raw = e.target.value.trim();
            if (raw === "") {
              onChange(null);
              return;
            }
            const n = Math.floor(Number(raw));
            onChange(Number.isFinite(n) ? Math.min(Math.max(n, 0), 500) : null);
          }}
        />
      </label>
      <p className={styles.fieldHint}>
        {value === null
          ? `Optional. Empty inherits your account default of ${accountDefault} outstanding runs.`
          : value === 0
            ? "0 stops this plan topping itself up at all — different from empty, which inherits your account default."
            : `This plan keeps ${value} run${value === 1 ? "" : "s"} outstanding before a top-up stops.`}
        {value !== null && (
          <>
            {" "}
            <button
              type="button"
              className={styles.chipGroupClear}
              onClick={() => onChange(null)}
            >
              Use my default
            </button>
          </>
        )}
      </p>
    </div>
  );
}

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

  const summaryBySlug = useMemo(
    () => new Map(testCases.map((c) => [c.slug, c])),
    [testCases],
  );
  const slugCategory = (slug: string): CatalogCategory | null => {
    const summary = summaryBySlug.get(slug);
    return summary ? categoryOf(summary) : null;
  };

  // The test-case type the case dropdown is scoped to, so it offers one
  // category's cases rather than the whole catalog in a single giant list (the
  // same partitioning the new-run form uses). Null until resolved below.
  const [category, setCategory] = useState<CatalogCategory | null>(null);
  const activeCategory: CatalogCategory =
    category ?? CATALOG_CATEGORIES[0]!.value;

  // Settle on the default type once the catalog metadata resolves. `useCatalog`
  // leads with the catalog's first case, which need not sit in the default
  // category — move the selection to that category's first case so the case
  // dropdown and the type agree.
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current || category !== null || !sel.slug) return;
    const currentCategory = slugCategory(sel.slug);
    // Wait until the selected case's catalog metadata has loaded to resolve it.
    if (currentCategory === null) return;
    initialized.current = true;
    const target = CATALOG_CATEGORIES[0]!.value;
    setCategory(target);
    if (currentCategory !== target) selectFirstOf(target);
    // slugCategory/testCaseName close over the catalog; re-run as it resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, sel.slug, sel.cases, summaryBySlug]);

  // Point the case selection at the first case of a category, so the version and
  // variant re-resolve for a case the dropdown actually shows.
  function selectFirstOf(next: CatalogCategory) {
    const first = [...sel.cases]
      .filter((c) => slugCategory(c.slug) === next)
      .sort((a, b) =>
        testCaseName(a.slug).localeCompare(testCaseName(b.slug)),
      )[0];
    if (first) sel.setSlug(first.slug);
  }

  function onCategoryChange(next: CatalogCategory) {
    setCategory(next);
    if (slugCategory(sel.slug) === next) return;
    selectFirstOf(next);
  }

  // The catalog arrives in slug order; sort by display name to match the labels.
  // Scoped to the selected type so the list only offers cases of that category.
  const sortedCases = useMemo(
    () =>
      [...sel.cases]
        .filter((c) => slugCategory(c.slug) === activeCategory)
        .sort((a, b) =>
          testCaseName(a.slug).localeCompare(testCaseName(b.slug)),
        ),
    // slugCategory closes over summaryBySlug; the list depends on both it and
    // the selected category.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sel.cases, testCaseName, summaryBySlug, activeCategory],
  );

  // Case pills grouped under their catalog category, each carrying its original
  // index (from the old config page). Unknown slugs fall into a trailing "Other".
  const caseGroups = useMemo(() => {
    const indexed = cases.map((c, i) => ({ c, i }));
    const order: (CatalogCategory | null)[] = [
      ...CATALOG_CATEGORIES.map((entry) => entry.value),
      null,
    ];
    return order
      .map((value) => ({
        category: value,
        items: indexed
          .filter(({ c }) => slugCategory(c.slug) === value)
          .sort(
            (a, b) =>
              testCaseName(a.c.slug).localeCompare(testCaseName(b.c.slug)) ||
              a.c.variant.localeCompare(b.c.variant) ||
              a.c.version.localeCompare(b.c.version),
          ),
      }))
      .filter((group) => group.items.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cases, summaryBySlug, testCaseName]);

  // A category with no cases in the catalog leaves the selection pointed at a case
  // the dropdown no longer offers; adding it would file a member the picker never
  // showed, so the add-row stays disabled until the two agree.
  const selectionShown = sortedCases.some((c) => c.slug === sel.slug);

  function addCase() {
    if (!selectionShown) return;
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
            <div key={group.category ?? "other"} className={styles.chipGroup}>
              <div className={styles.chipGroupHead}>
                <span className={styles.chipGroupTitle}>
                  {group.category ? categoryLabel(group.category) : "Other"}
                </span>
                <button
                  type="button"
                  className={styles.chipGroupClear}
                  onClick={() =>
                    onChange(
                      cases.filter(
                        (c) => slugCategory(c.slug) !== group.category,
                      ),
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
          <span className={exec.fieldLabel}>Test case type</span>
          <select
            className={exec.select}
            value={activeCategory}
            onChange={(e) =>
              onCategoryChange(e.target.value as CatalogCategory)
            }
          >
            {CATALOG_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
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
          disabled={
            !selectionShown || !sel.slug || !sel.version || !sel.variant
          }
        >
          + Add
        </button>
      </div>
    </>
  );
}
