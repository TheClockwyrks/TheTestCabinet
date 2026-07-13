import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import type {
  CoverageCell,
  CoverageMatrix,
  ReviewPlan,
} from "@test-cabinet/run-record/review-plan";
import { useAuth } from "../../../client/auth";
import { useBackend, useWorkers } from "../../../client/context";
import { DEFAULT_ORCHESTRATOR_SLUG } from "../../data/orchestrators";
import { OPENROUTER_PROVIDER, resolveLaunchModel } from "../../data/providers";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { useTestCaseName } from "../../data/useTestCaseName";
import { useRunsRuntime } from "../../runtime/runsRuntime";
import { routes } from "../../routes";
import { RunsTabs } from "./RunsTabs";
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

  // Load the plan and its coverage once signed in. Editing the plan itself lives
  // on its own page (`/runs/coverage/config`), so the dashboard only reads.
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
        {coverage && coverage.cellsTotal > 0 && (
          <Link className={exec.secondary} to={routes.runCoverageConfig()}>
            Edit plan
          </Link>
        )}
      </div>

      <RunsTabs active="coverage" />

      {error && <p className={`${exec.notice} ${exec.error}`}>{error}</p>}
      {!canTrigger && (
        <p className={`${exec.notice} ${exec.warn}`}>
          No worker connected — open the connections drawer (the gear in the top
          bar) to add a worker before triggering runs.
        </p>
      )}

      {loading ? (
        <p className={styles.empty}>Loading coverage…</p>
      ) : !coverage || coverage.cellsTotal === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.empty}>
            Your review plan is empty. Set it up to declare the cases and
            harness/model combinations you want covered, and this dashboard will
            show what still needs running.
          </p>
          <Link className={exec.primary} to={routes.runCoverageConfig()}>
            Set up your plan
          </Link>
        </div>
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
