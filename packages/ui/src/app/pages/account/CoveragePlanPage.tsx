import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import type {
  CoverageCell,
  CoverageMatrix,
  CoveragePlanSummary,
} from "@test-cabinet/run-record/coverage";
import { useAuth } from "../../../client/auth";
import { useBackend, useWorkers } from "../../../client/context";
import { DEFAULT_ORCHESTRATOR_SLUG } from "../../data/orchestrators";
import { OPENROUTER_PROVIDER, resolveLaunchModel } from "../../data/providers";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { useTestCaseName } from "../../data/useTestCaseName";
import { useRunsRuntime } from "../../runtime/runsRuntime";
import { routes } from "../../routes";
import { launchBatch, type LaunchItem } from "../runs/launchBatch";
import { AccountTabs } from "./AccountTabs";
import exec from "../runs/RunExec.module.scss";
import styles from "./Coverage.module.scss";

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
function caseKey(c: { slug: string; version: string; variant: string }): string {
  return `${c.slug}@${c.version}@${c.variant}`;
}

// Build the launch items for a set of coverage cells — `remaining` runs per cell,
// each config resolved exactly as the new-run form does (provider prefix applied
// for provider-routed harnesses; the default one-shot orchestrator, since a plan
// does not pin one).
function itemsForCells(cells: CoverageCell[]): LaunchItem[] {
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

// One test case's collapsible block: its header (name, variant/version, a stale-pin
// hint, and the case-wide progress rollup) is always shown; the per-harness/model
// rows are revealed only when expanded. Starts collapsed so a large plan reads as a
// scannable list of case progress bars, mirroring the Inputs/Changelog accordion.
export function CaseSection({
  group,
  busy,
  canTrigger,
  onTrigger,
}: {
  group: CaseGroup;
  busy: boolean;
  canTrigger: boolean;
  onTrigger: (cells: CoverageCell[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const testCaseName = useTestCaseName();
  const { cell0, cells, done, desired, donePct, flightPct } = group;

  return (
    <section className={styles.group}>
      <header
        className={`${styles.groupHead} ${
          open ? "" : styles.groupHeadCollapsed
        }`}
      >
        <button
          type="button"
          className={styles.groupToggle}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className={styles.twisty} aria-hidden>
            {open ? "▾" : "▸"}
          </span>
          <span className={styles.groupTitle}>
            {testCaseName(cell0.slug)}
            <span className={styles.groupVersion}>
              {cell0.variant} · {cell0.version}
            </span>
          </span>
        </button>
        <span className={styles.groupRight}>
          {cell0.stale && (
            <span
              className={styles.staleBadge}
              title={`A newer version (${cell0.latestVersion}) is ingested. Bump the pin from the plan editor.`}
            >
              {cell0.version} → {cell0.latestVersion} ↑
            </span>
          )}
          <span
            className={styles.groupProgress}
            title={`${done} of ${desired} runs across all harness/model combinations`}
          >
            <span className={styles.groupBar} aria-hidden>
              <span
                className={styles.groupBarDone}
                style={{ width: `${donePct}%` }}
              />
              <span
                className={styles.groupBarFlight}
                style={{ width: `${flightPct}%` }}
              />
            </span>
            <span className={styles.groupCount}>
              {done}/{desired}
            </span>
          </span>
        </span>
      </header>
      {open && (
        <ul className={styles.cellList}>
          {cells.map((cell) => {
            const cellDone = cell.completed + cell.inFlight;
            const satisfied = cell.remaining === 0;
            const cellDonePct =
              cell.desired > 0
                ? Math.min(100, (cell.completed / cell.desired) * 100)
                : 0;
            const cellFlightPct =
              cell.desired > 0
                ? Math.min(
                    100 - cellDonePct,
                    (cell.inFlight / cell.desired) * 100,
                  )
                : 0;
            return (
              <li
                key={cellKey(cell)}
                className={`${styles.cell} ${satisfied ? styles.cellDone : ""}`}
              >
                <span className={styles.cellLabel}>
                  {cell.harness} · {cell.model}
                </span>
                <span className={styles.cellBar} aria-hidden>
                  <span
                    className={styles.cellBarDone}
                    style={{ width: `${cellDonePct}%` }}
                  />
                  <span
                    className={styles.cellBarFlight}
                    style={{ width: `${cellFlightPct}%` }}
                  />
                </span>
                <span className={styles.cellCount}>
                  {cellDone}/{cell.desired}
                </span>
                <button
                  className={`${exec.secondary} ${styles.cellButton}`}
                  type="button"
                  disabled={busy || !canTrigger || satisfied}
                  onClick={() => onTrigger([{ ...cell, remaining: 1 }])}
                >
                  {satisfied ? "Covered" : "Trigger one"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export interface CaseGroup {
  cell0: CoverageCell;
  cells: CoverageCell[];
  done: number;
  desired: number;
  donePct: number;
  flightPct: number;
}

// The per-plan coverage dashboard (`/account/coverage/:planId`): the matrix of what
// this plan still needs, with each case collapsible and a "Trigger all missing"
// scoped to just this plan. Console-only; gated on a signed-in account.
export function CoveragePlanPage() {
  const { planId = "" } = useParams();
  const { token } = useAuth();
  const { client: backend } = useBackend();
  const { active: worker } = useWorkers();
  const runtime = useRunsRuntime();
  const testCaseName = useTestCaseName();

  const [coverage, setCoverage] = useState<CoverageMatrix | null>(null);
  const [plan, setPlan] = useState<CoveragePlanSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canTrigger = Boolean(worker && (worker.local || token));

  const reloadCoverage = useCallback(async () => {
    if (!backend?.getCoveragePlanCoverage || !token) return;
    setCoverage(await backend.getCoveragePlanCoverage(planId, token));
  }, [backend, token, planId]);

  useEffect(() => {
    if (!backend || !token) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([
      backend.getCoveragePlanCoverage?.(planId, token) ?? Promise.resolve(null),
      backend.getCoveragePlansSummary?.(token) ?? Promise.resolve([]),
    ])
      .then(([cov, summaries]) => {
        if (!active) return;
        setCoverage(cov);
        setPlan(summaries.find((p) => p.id === planId) ?? null);
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
  }, [backend, token, planId]);

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

  // The matrix grouped by case (outer axis), each carrying its cells (inner axis),
  // its resolved staleness, and the case-wide progress rolled up across every
  // combination.
  const groups = useMemo<CaseGroup[]>(() => {
    if (!coverage) return [];
    const byCase = new Map<string, { cell0: CoverageCell; cells: CoverageCell[] }>();
    for (const cell of coverage.cells) {
      const key = caseKey(cell);
      const group = byCase.get(key);
      if (group) group.cells.push(cell);
      else byCase.set(key, { cell0: cell, cells: [cell] });
    }
    return [...byCase.values()]
      .map(({ cell0, cells }) => {
        const sortedCells = [...cells].sort(
          (a, b) =>
            a.harness.localeCompare(b.harness) || a.model.localeCompare(b.model),
        );
        const completed = sortedCells.reduce((sum, c) => sum + c.completed, 0);
        const inFlight = sortedCells.reduce((sum, c) => sum + c.inFlight, 0);
        const desired = sortedCells.reduce((sum, c) => sum + c.desired, 0);
        const done = completed + inFlight;
        const donePct =
          desired > 0 ? Math.min(100, (completed / desired) * 100) : 0;
        const flightPct =
          desired > 0 ? Math.min(100 - donePct, (inFlight / desired) * 100) : 0;
        return { cell0, cells: sortedCells, done, desired, donePct, flightPct };
      })
      .sort(
        (a, b) =>
          testCaseName(a.cell0.slug).localeCompare(testCaseName(b.cell0.slug)) ||
          a.cell0.variant.localeCompare(b.cell0.variant) ||
          a.cell0.version.localeCompare(b.cell0.version),
      );
  }, [coverage, testCaseName]);

  const deficientCells = useMemo(
    () => coverage?.cells.filter((c) => c.remaining > 0) ?? [],
    [coverage],
  );

  if (!token) {
    return (
      <PageLayout>
        <AccountTabs active="coverage" />
        <p className={`${exec.notice} ${exec.warn}`}>
          Sign in to view a coverage plan — plans are saved to your account.
        </p>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <AccountTabs active="coverage" />
      <div className={exec.runsHeader}>
        <PromptHeader
          command={`--account/coverage/${plan?.name ?? planId}`}
          comment={<>// what this plan still needs running</>}
        />
        <span className={styles.rowActions}>
          <Link className={exec.secondary} to={routes.accountCoverage()}>
            All plans
          </Link>
          <Link
            className={exec.secondary}
            to={routes.accountCoveragePlanEdit(planId)}
          >
            Edit plan
          </Link>
        </span>
      </div>

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
            This plan is empty. Edit it to add the cases and harness/model
            combinations you want covered.
          </p>
          <Link
            className={exec.primary}
            to={routes.accountCoveragePlanEdit(planId)}
          >
            Edit this plan
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
              className={`${exec.primary} ${styles.summaryTrigger}`}
              type="button"
              disabled={busy || !canTrigger || coverage.runsMissing === 0}
              onClick={() => triggerCells(deficientCells)}
            >
              {busy ? "Triggering…" : "Trigger all missing"}
            </button>
          </div>

          <div className={styles.matrix}>
            {groups.map((group) => (
              <CaseSection
                key={caseKey(group.cell0)}
                group={group}
                busy={busy}
                canTrigger={canTrigger}
                onTrigger={triggerCells}
              />
            ))}
          </div>
        </>
      )}
    </PageLayout>
  );
}
