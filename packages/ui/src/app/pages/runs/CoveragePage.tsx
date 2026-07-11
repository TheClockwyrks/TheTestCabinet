import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import type {
  CoverageCell,
  CoverageMatrix,
  ReviewPlan,
  ReviewPlanCombo,
} from "@test-cabinet/run-record/review-plan";
import { useAuth } from "../../../client/auth";
import { useBackend, useWorkers } from "../../../client/context";
import type { Model } from "../../../client/types";
import { harnesses } from "../../data/harnesses";
import { DEFAULT_ORCHESTRATOR_SLUG } from "../../data/orchestrators";
import {
  OPENROUTER_PROVIDER,
  PROVIDERS,
  harnessUsesProvider,
  resolveLaunchModel,
} from "../../data/providers";
import { ModelCombobox } from "../../components/ModelCombobox";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { useCatalog } from "../../runtime/useCatalog";
import { useTestCaseName } from "../../data/useTestCaseName";
import { useRunsRuntime } from "../../runtime/runsRuntime";
import { routes } from "../../routes";
import { launchBatch, type LaunchItem } from "./launchBatch";
import exec from "./RunExec.module.scss";
import styles from "./Coverage.module.scss";

const EMPTY_PLAN: ReviewPlan = {
  runsPerCell: 3,
  cases: [],
  combinations: [],
};

// A cell's identity, so a group's cells and a trigger's target line up.
function cellKey(c: {
  slug: string;
  version: string;
  variant: string;
  harness: string;
  model: string;
}): string {
  return `${c.slug}@${c.version}@${c.variant}::${c.harness}::${c.model}`;
}

// A case group's identity (the outer axis of the matrix).
function caseKey(c: {
  slug: string;
  version: string;
  variant: string;
}): string {
  return `${c.slug}@${c.version}@${c.variant}`;
}

// Build the launch items for a set of coverage cells — `remaining` runs per cell,
// each config resolved exactly as the new-run form does (provider prefix applied
// for provider-routed harnesses; the default one-shot orchestrator, since a plan
// does not pin one). Exported so the Home coverage widget triggers the same way.
export function itemsForCells(cells: CoverageCell[]): LaunchItem[] {
  return cells.flatMap((cell) =>
    Array.from({ length: cell.remaining }, () => ({
      config: {
        testCase: cell.slug,
        version: cell.version,
        variant: cell.variant,
        harness: cell.harness,
        modelId: resolveLaunchModel(
          cell.harness,
          cell.provider ?? OPENROUTER_PROVIDER,
          cell.model,
        ),
        orchestrator: DEFAULT_ORCHESTRATOR_SLUG,
        maxRuntimeOverride: null,
      },
      track: {
        testCaseSlug: cell.slug,
        testCaseVersion: cell.version,
        variant: cell.variant,
        harnessSlug: cell.harness,
        modelId: cell.model,
      },
    })),
  );
}

// The reviewer coverage dashboard: declare a plan (the harness+model combinations
// and version-pinned test cases you want covered, and a target runs-per-cell), see
// the matrix of what still needs running, and trigger the missing runs — one cell
// or all of them. The plan is per-account, so this is gated on a signed-in
// reviewer; console-only (the static site never mounts this route).
export function CoveragePage() {
  const { token } = useAuth();
  const { client: backend } = useBackend();
  const { active: worker } = useWorkers();
  const runtime = useRunsRuntime();
  const testCaseName = useTestCaseName();

  const [coverage, setCoverage] = useState<CoverageMatrix | null>(null);
  const [savedPlan, setSavedPlan] = useState<ReviewPlan | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A remote (service-driven) worker enqueues on the backend's `POST /jobs`, gated
  // on the account — so triggering needs the worker and (unless it is the local
  // in-process one) the token we already require for the plan.
  const canTrigger = Boolean(worker && (worker.local || token));

  const reloadCoverage = useCallback(async () => {
    if (!backend?.getCoverage || !token) return;
    const cov = await backend.getCoverage(token);
    setCoverage(cov);
  }, [backend, token]);

  // Load the plan, its coverage, and the model catalog once signed in. The model
  // catalog feeds the plan editor's model picker (same source as the new-run form).
  useEffect(() => {
    if (!backend || !token) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([
      backend.getReviewPlan?.(token) ?? Promise.resolve(EMPTY_PLAN),
      backend.getCoverage?.(token) ?? Promise.resolve(null),
    ])
      .then(([plan, cov]) => {
        if (!active) return;
        setSavedPlan(plan ?? EMPTY_PLAN);
        setCoverage(cov);
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
        /* optional; the editor's model field stays free-text */
      });
    return () => {
      active = false;
    };
  }, [backend, token]);

  // Trigger the still-missing runs for a set of cells, then refresh the matrix so
  // the just-queued runs move into the in-flight count.
  const triggerCells = useCallback(
    async (cells: CoverageCell[]) => {
      if (!worker || !canTrigger) return;
      const items = itemsForCells(cells);
      if (items.length === 0) return;
      setBusy(true);
      setError(null);
      try {
        await launchBatch(worker, token, runtime.track, items);
        await reloadCoverage();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [worker, canTrigger, token, runtime.track, reloadCoverage],
  );

  // Bump a case's pinned version to the newest ingested one and save immediately —
  // the one-click fix for the staleness badge.
  const bumpCase = useCallback(
    async (cell: CoverageCell) => {
      if (
        !backend?.putReviewPlan ||
        !savedPlan ||
        !token ||
        !cell.latestVersion
      )
        return;
      const next: ReviewPlan = {
        ...savedPlan,
        cases: savedPlan.cases.map((c) =>
          c.slug === cell.slug &&
          c.version === cell.version &&
          c.variant === cell.variant
            ? { ...c, version: cell.latestVersion }
            : c,
        ),
      };
      setBusy(true);
      setError(null);
      try {
        await backend.putReviewPlan(next, token);
        setSavedPlan(next);
        await reloadCoverage();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [backend, savedPlan, token, reloadCoverage],
  );

  // The matrix grouped by case (outer axis), each group carrying its cells (inner
  // axis, one per combination) and its resolved staleness from any cell.
  const groups = useMemo(() => {
    if (!coverage) return [];
    const byCase = new Map<
      string,
      { cell0: CoverageCell; cells: CoverageCell[] }
    >();
    for (const cell of coverage.cells) {
      const key = caseKey(cell);
      const group = byCase.get(key);
      if (group) group.cells.push(cell);
      else byCase.set(key, { cell0: cell, cells: [cell] });
    }
    return [...byCase.values()];
  }, [coverage]);

  const deficientCells = useMemo(
    () => coverage?.cells.filter((c) => c.remaining > 0) ?? [],
    [coverage],
  );

  if (!token) {
    return (
      <PageLayout>
        <PromptHeader command="--runs/coverage" comment={<>// review plan</>} />
        <p className={`${exec.notice} ${exec.warn}`}>
          Sign in to use your review plan — it is saved to your account. Use the
          account control in the top bar to register or log in.
        </p>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <div className={exec.runsHeader}>
        <PromptHeader
          command="--runs/coverage"
          comment={<>// what still needs running</>}
        />
        <span className={exec.headerActions}>
          <Link className={exec.secondary} to={routes.runUnreviewed()}>
            Unreviewed
          </Link>
          <Link className={exec.secondary} to={routes.runs()}>
            All runs
          </Link>
          {!editing && (
            <button
              className={exec.secondary}
              type="button"
              onClick={() => setEditing(true)}
            >
              Edit plan
            </button>
          )}
        </span>
      </div>

      {error && <p className={`${exec.notice} ${exec.error}`}>{error}</p>}
      {!canTrigger && (
        <p className={`${exec.notice} ${exec.warn}`}>
          No worker connected — open the connections drawer (the gear in the top
          bar) to add a worker before triggering runs.
        </p>
      )}

      {editing && savedPlan && (
        <PlanEditor
          initial={savedPlan}
          models={models}
          busy={busy}
          onCancel={() => setEditing(false)}
          onSave={async (plan) => {
            if (!backend?.putReviewPlan) return;
            setBusy(true);
            setError(null);
            try {
              await backend.putReviewPlan(plan, token);
              setSavedPlan(plan);
              setEditing(false);
              await reloadCoverage();
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {loading ? (
        <p className={styles.empty}>Loading coverage…</p>
      ) : !coverage || coverage.cellsTotal === 0 ? (
        !editing && (
          <p className={styles.empty}>
            Your review plan is empty.{" "}
            <button
              className={exec.secondary}
              type="button"
              onClick={() => setEditing(true)}
            >
              Set up your plan
            </button>{" "}
            to declare the cases and harness/model combinations to cover.
          </p>
        )
      ) : (
        <>
          <div className={styles.summary}>
            <span className={styles.summaryStat}>
              <strong>
                {coverage.cellsSatisfied}/{coverage.cellsTotal}
              </strong>{" "}
              cells covered
            </span>
            <span className={styles.summaryStat}>
              <strong>{coverage.runsMissing}</strong> runs missing
            </span>
            <button
              className={exec.primary}
              type="button"
              disabled={busy || !canTrigger || coverage.runsMissing === 0}
              onClick={() => triggerCells(deficientCells)}
            >
              {busy ? "Triggering…" : "Trigger all missing"}
            </button>
          </div>

          <div className={styles.matrix}>
            {groups.map(({ cell0, cells }) => (
              <section key={caseKey(cell0)} className={styles.group}>
                <header className={styles.groupHead}>
                  <span className={styles.groupTitle}>
                    {testCaseName(cell0.slug)}
                    <span className={styles.groupVersion}>
                      {cell0.variant} · {cell0.version}
                    </span>
                  </span>
                  {cell0.stale && (
                    <button
                      className={styles.staleBadge}
                      type="button"
                      disabled={busy}
                      title={`A newer version (${cell0.latestVersion}) is ingested. Bump the pin.`}
                      onClick={() => bumpCase(cell0)}
                    >
                      {cell0.version} → {cell0.latestVersion} ↑
                    </button>
                  )}
                </header>
                <ul className={styles.cellList}>
                  {cells.map((cell) => {
                    const done = cell.completed + cell.inFlight;
                    const satisfied = cell.remaining === 0;
                    const pct =
                      cell.desired > 0
                        ? Math.min(100, (done / cell.desired) * 100)
                        : 0;
                    return (
                      <li
                        key={cellKey(cell)}
                        className={`${styles.cell} ${
                          satisfied ? styles.cellDone : ""
                        }`}
                      >
                        <span className={styles.cellLabel}>
                          {cell.harness} · {cell.model}
                        </span>
                        <span className={styles.cellBar} aria-hidden>
                          <span
                            className={styles.cellBarFill}
                            style={{ width: `${pct}%` }}
                          />
                        </span>
                        <span className={styles.cellCount}>
                          {done}/{cell.desired}
                          {cell.inFlight > 0 && (
                            <span className={styles.cellInFlight}>
                              {" "}
                              ({cell.inFlight} in-flight)
                            </span>
                          )}
                        </span>
                        <button
                          className={exec.secondary}
                          type="button"
                          disabled={busy || !canTrigger || satisfied}
                          onClick={() => triggerCells([cell])}
                        >
                          {satisfied ? "Covered" : `Trigger ${cell.remaining}`}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </PageLayout>
  );
}

// The in-page plan editor: a runs-per-cell target, a repeatable list of
// harness+model combinations, and a list of version-pinned test cases (added
// through a single case picker, reusing the catalog cursor). Saving hands the
// assembled plan up to the page, which persists it.
function PlanEditor({
  initial,
  models,
  busy,
  onSave,
  onCancel,
}: {
  initial: ReviewPlan;
  models: Model[];
  busy: boolean;
  onSave: (plan: ReviewPlan) => void;
  onCancel: () => void;
}) {
  const testCaseName = useTestCaseName();
  const [runsPerCell, setRunsPerCell] = useState(
    Math.max(1, initial.runsPerCell || 1),
  );
  const [cases, setCases] = useState(initial.cases);
  const [combinations, setCombinations] = useState(initial.combinations);

  // The add-a-combination picker.
  const [addHarness, setAddHarness] = useState(harnesses[0]?.slug ?? "");
  const [addModel, setAddModel] = useState("");
  const [addProvider, setAddProvider] = useState(OPENROUTER_PROVIDER);

  // The add-a-case picker reuses the catalog cursor (case → version → variant).
  const sel = useCatalog();

  const harnessName = (slug: string) =>
    harnesses.find((h) => h.slug === slug)?.displayName ?? slug;

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

  const versions = sel.cases.find((c) => c.slug === sel.slug)?.versions ?? [];

  return (
    <section className={styles.editor}>
      <p className={exec.sectionLabel}>Review plan</p>

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
            setRunsPerCell(Number.isFinite(n) && n >= 1 ? Math.min(n, 100) : 1);
          }}
        />
      </label>

      <p className={exec.sectionLabel}>Harness / model combinations</p>
      {combinations.length > 0 && (
        <ul className={styles.chipList}>
          {combinations.map((combo, i) => (
            <li
              key={`${combo.harness}:${combo.model}:${i}`}
              className={styles.chip}
            >
              <span>
                {harnessName(combo.harness)} · {combo.model}
                {combo.provider ? ` · ${combo.provider}` : ""}
              </span>
              <button
                type="button"
                className={exec.comboRemove}
                aria-label="Remove combination"
                onClick={() =>
                  setCombinations((prev) => prev.filter((_, j) => j !== i))
                }
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={exec.comboRow}>
        <label className={`${exec.field} ${exec.comboField}`}>
          <span className={exec.fieldLabel}>Harness</span>
          <select
            className={exec.select}
            value={addHarness}
            onChange={(e) => setAddHarness(e.target.value)}
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
      {cases.length > 0 && (
        <ul className={styles.chipList}>
          {cases.map((c, i) => (
            <li
              key={`${c.slug}@${c.version}@${c.variant}`}
              className={styles.chip}
            >
              <span>
                {testCaseName(c.slug)} · {c.variant} · {c.version}
              </span>
              <button
                type="button"
                className={exec.comboRemove}
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
      )}
      <div className={exec.comboRow}>
        <label className={`${exec.field} ${exec.comboField}`}>
          <span className={exec.fieldLabel}>Test case</span>
          <select
            className={exec.select}
            value={sel.slug}
            onChange={(e) => sel.setSlug(e.target.value)}
          >
            {sel.cases.map((c) => (
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

      <div className={exec.actions}>
        <button
          type="button"
          className={exec.primary}
          disabled={busy}
          onClick={() => onSave({ runsPerCell, cases, combinations })}
        >
          {busy ? "Saving…" : "Save plan"}
        </button>
        <button
          type="button"
          className={exec.secondary}
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
