import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, NavLink, Outlet, useLocation, useParams } from "react-router";
import { Panel } from "@clockwyrks/ui";
import type {
  CoverageCell,
  CoverageMatrix,
  CoveragePlanOut,
  CoverageQueue,
  HaltResult,
} from "@clockwyrks/run-record/coverage";
import { LoadingState } from "../../components/LoadingState";
import { PageLayout } from "../../components/PageLayout";
import { BackChevron } from "../../components/BackChevron";
import { useConfirm } from "../../components/ConfirmDialog";
import { SubmitNotice } from "../../components/SubmitNotice";
import { useRecordSectionIndex } from "../../components/backReturn";
import { useAuth } from "../../../client/auth";
import { useBackend, useWorkers } from "../../../client/context";
import { useTestCaseName } from "../../data/useTestCaseName";
import { useRunsRuntime } from "../../runtime/runsRuntime";
import { useLiveRunUpdates } from "../../runtime/useLiveRunUpdates";
import { routes } from "../../routes";
import { launchBatch } from "../runs/launchBatch";
import { useGgConfigs } from "../runs/gg/useGgConfigs";
import { comboLabel } from "./comboLabels";
import {
  PLAN_ATTENTION_LABEL,
  PLAN_ATTENTION_TITLE,
  buildGroups,
  describeHalt,
  describeFill,
  ggTriggerReadiness,
  itemsForCells,
  launchGgCells,
  planGgLaunches,
  unresolvedGgProblem,
  type MatrixGroup,
} from "./coveragePlan";
import exec from "../runs/RunExec.module.scss";
import styles from "./Coverage.module.scss";

/** Which surface of a plan the rendering page is, so its tab reads as active. */
export type CoveragePlanTab = "dashboard" | "reviews" | "tests";

/**
 * Everything a plan's tabs render from: the board the backend derived, the plan's own
 * configuration, and the actions that move both.
 *
 * The tabs share one fetch and one set of actions because they describe one plan: a
 * fill started on the dashboard changes what the Tests tab draws and what the Reviews
 * tab lists, and three surfaces each holding their own copy would disagree the moment
 * any control was pressed.
 */
export interface CoveragePlanState {
  /** The plan's id, from the route. */
  planId: string;
  /** The plan as saved, or null while it is still resolving. */
  plan: CoveragePlanOut | null;
  /** The derived board: every cell with its counts. */
  coverage: CoverageMatrix;
  /** The plan's unreviewed-by-me runs, in the plan's own order. */
  queue: CoverageQueue | null;
  /** The board's cells grouped on the plan's own ordering axis, in its own order. */
  groups: MatrixGroup[];
  /** The cells a "launch everything missing" press would actually launch. */
  deficientCells: CoverageCell[];
  /** True while a control's request is in flight; every control disables on it. */
  busy: boolean;
  /** Whether a hand-triggered run can be launched at all. */
  canTrigger: boolean;
  /** Whether a worker is connected to execute a hand-triggered run. */
  hasWorker: boolean;
  /** Re-read the board and the queue. */
  refresh: () => Promise<void>;
  /** Whether the plan is filling: the backend launches its missing runs as runs finish. */
  filling: boolean;
  /** Start filling the plan (All missing): one launch pass now, the rest as runs finish. */
  fill: () => Promise<void>;
  /** Launch a set of cells by hand, `remaining` runs each. */
  triggerCells: (cells: CoverageCell[]) => Promise<void>;
  /**
   * Whether the filling plan is waiting on its owner: nothing of it is in flight,
   * nothing a launch pass could launch is left, and a cell is blocked.
   */
  needsAttention: boolean;
  /** Retry a cell blocked on a run that used up its automatic retries. */
  retryCell: (cell: CoverageCell) => Promise<void>;
  /** Stop filling and cancel this plan's jobs; `all` sweeps running ones too. */
  halt: (all: boolean) => Promise<void>;
}

const CoveragePlanContext = createContext<CoveragePlanState | null>(null);

/** The plan the surrounding {@link CoveragePlanLayout} resolved. */
export function useCoveragePlan(): CoveragePlanState {
  const state = useContext(CoveragePlanContext);
  if (!state) {
    throw new Error("useCoveragePlan must be used inside a CoveragePlanLayout");
  }
  return state;
}

/**
 * Which of a plan's surfaces a path names.
 *
 * The layout is the tabs' parent route rather than a component each of them renders, so
 * the active tab is read off the URL here instead of being passed in. That parenthood
 * is what keeps one layout mounted across a tab press: the tabs share a single fetch
 * and a single set of controls, and pressing a tab moves only the body beneath them.
 */
export function planTabOf(pathname: string): CoveragePlanTab {
  if (pathname.endsWith("/reviews")) return "reviews";
  if (pathname.endsWith("/tests")) return "tests";
  return "dashboard";
}

// The tab strip across a plan's surfaces. Each tab is its own route, so a surface is
// linkable and a reviewer can sit on the one they are working from, mirroring the test
// case and runs strips. Reviews carries its count of runs to review, which is
// informational: reviews never launch or hold back a run.
function PlanTabs({
  tab,
  planId,
  unreviewed,
}: {
  tab: CoveragePlanTab;
  planId: string;
  unreviewed: number;
}) {
  const tabs: { key: CoveragePlanTab; label: string; to: string }[] = [
    {
      key: "dashboard",
      label: "Dashboard",
      to: routes.accountCoveragePlan(planId),
    },
    {
      key: "reviews",
      label: unreviewed > 0 ? `Reviews (${unreviewed})` : "Reviews",
      to: routes.accountCoveragePlanReviews(planId),
    },
    {
      key: "tests",
      label: "Tests",
      to: routes.accountCoveragePlanTests(planId),
    },
  ];
  return (
    <div className={styles.tabStrip}>
      <nav className={styles.tabs} aria-label="Coverage plan sections">
        {tabs.map((entry) => (
          <NavLink
            key={entry.key}
            to={entry.to}
            end
            className={
              entry.key === tab
                ? `${styles.tab} ${styles.tabActive}`
                : styles.tab
            }
            aria-current={entry.key === tab ? "page" : undefined}
          >
            {entry.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

/**
 * The shared chrome and shared state of a coverage plan's three tabs
 * (`/account/coverage/:planId`, `…/reviews`, `…/tests`), which it hosts as its child
 * routes.
 *
 * It resolves the plan, its derived board, and its review queue; owns every control
 * that changes them; and publishes all of it to the active tab through
 * {@link useCoveragePlan}. Resolving lives here so the tabs stay thin and can never
 * disagree about what the plan is doing.
 *
 * Opening the page is a read and only a read: a plan's runs are launched by its
 * owner's controls and, while it is filling, by the backend as runs finish.
 *
 * Console-only, and gated on a signed-in account: plans are saved per account.
 */
export function CoveragePlanLayout() {
  const { planId = "" } = useParams();
  const { pathname } = useLocation();
  const tab = planTabOf(pathname);
  const { token } = useAuth();
  const { client: backend } = useBackend();
  const { confirm } = useConfirm();
  const { active: worker } = useWorkers();
  const runtime = useRunsRuntime();
  const testCaseName = useTestCaseName();
  // The account's gg configurations, needed only to trigger a gg cell by hand: the
  // matrix already carries every gg cell's name and models, but launching one needs the
  // capability set behind it, which only the configuration itself has. The load's state
  // is read alongside them, because "none yet" and "the request failed" resolve gg
  // cells identically and mean opposite things (see `ggTriggerReadiness`).
  const {
    options: ggOptions,
    loading: ggLoading,
    error: ggError,
  } = useGgConfigs();

  // Record this plan as the coverage section's index, so a run opened from a cell or
  // from the review queue returns to the tab it was opened from (see `backReturn`).
  useRecordSectionIndex("coverage");

  // The board's counts move as the plan's runs finish and as the backend launches the
  // next ones, so the page holds the console stream's run-lifecycle topic open for as
  // long as it is on screen.
  useLiveRunUpdates();
  const { refreshToken, inProgress } = runtime;

  const [coverage, setCoverage] = useState<CoverageMatrix | null>(null);
  const [plan, setPlan] = useState<CoveragePlanOut | null>(null);
  const [queue, setQueue] = useState<CoverageQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The last thing a control did (filled, halted, retried), reported verbatim: these
  // actions are only trustworthy if they say what they changed.
  const [note, setNote] = useState<string | null>(null);

  // A worker is what executes a hand-triggered run; the gg configurations are what one
  // of them is built from. They are kept apart because only the first is worth its own
  // standing notice — the second resolves on its own within a moment of the page
  // opening.
  const hasWorker = Boolean(worker && token);
  const ggTrigger = ggTriggerReadiness(ggLoading, ggError);
  const canTrigger = hasWorker && ggTrigger.ready;

  // Re-read everything the controls can move: the matrix's counts, and the review
  // queue.
  const refresh = useCallback(async () => {
    if (!backend || !token) return;
    const [cov, q] = await Promise.all([
      backend.getCoveragePlanCoverage?.(planId, token) ?? Promise.resolve(null),
      backend.getCoveragePlanQueue?.(planId, token) ?? Promise.resolve(null),
    ]);
    setCoverage(cov);
    setQueue(q);
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
      backend.listCoveragePlans?.(token) ?? Promise.resolve([]),
      backend.getCoveragePlanQueue?.(planId, token) ?? Promise.resolve(null),
    ])
      .then(([cov, plans, q]) => {
        if (!active) return;
        setCoverage(cov);
        setPlan(plans.find((p) => p.id === planId) ?? null);
        setQueue(q);
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

  // A run finishing moves the board without anyone touching it (a cell gains a counted
  // run), and while the plan is filling the backend launches the next runs a moment
  // later, which arrive on the same stream as newly queued runs. So re-read on each
  // finished event and whenever the set of runs in flight changes — skipping the
  // mount, which the load above has just done. Debounced, because a launch pass
  // enqueues whole cells at once and one re-read covers them all.
  const seenRefresh = useRef(refreshToken);
  useEffect(() => {
    if (seenRefresh.current === refreshToken) return;
    seenRefresh.current = refreshToken;
    void refresh().catch(() => {});
  }, [refreshToken, refresh]);
  const inFlightKey = inProgress
    .map((r) => r.runId)
    .sort()
    .join("|");
  const seenInFlight = useRef(inFlightKey);
  useEffect(() => {
    if (seenInFlight.current === inFlightKey) return;
    seenInFlight.current = inFlightKey;
    const timer = setTimeout(() => void refresh().catch(() => {}), 300);
    return () => clearTimeout(timer);
  }, [inFlightKey, refresh]);

  // Start filling the plan: the backend runs one launch pass now — whole missing cells
  // in the plan's order, up to its runs-in-flight limit — and launches the rest itself
  // as the plan's runs finish. Always answers, even to say nothing was launched.
  const fill = useCallback(async () => {
    if (!backend?.fillCoveragePlan || !token) return;
    setBusy(true);
    setError(null);
    try {
      const result = await backend.fillCoveragePlan(planId, token);
      setNote(describeFill(result));
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [backend, token, planId, refresh]);

  // Retry a cell blocked on a run that used up its automatic retries, once its owner
  // has fixed the cause: the backend forgets that failure and launches the cell's
  // shortfall (under the limit while filling, at once otherwise).
  const retryCell = useCallback(
    async (cell: CoverageCell) => {
      if (!backend?.retryCoveragePlanCell || !token) return;
      setBusy(true);
      setError(null);
      try {
        await backend.retryCoveragePlanCell(
          planId,
          {
            case: {
              slug: cell.slug,
              version: cell.version,
              variant: cell.variant,
              engine: cell.engine === "none" ? undefined : cell.engine,
            },
            combination: {
              harness: cell.harness,
              model: cell.model,
              provider: cell.provider,
              ggConfigId: cell.ggConfigId,
              ggSlotModels: cell.ggSlotModels,
            },
          },
          token,
        );
        setNote(`Retrying ${comboLabel(cell)}: its runs are launching again.`);
        await refresh();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [backend, token, planId, refresh],
  );

  // Launch a set of cells by hand. The two shapes a combination takes go out on two
  // different endpoints — harness cells in one batch, gg cells one gg run each — so the
  // trigger fans out to both and reports what did not go.
  const triggerCells = useCallback(
    async (cells: CoverageCell[]) => {
      if (!worker || !canTrigger) return;
      // A launch by hand is a launch request the console sends, so the plan's retry
      // limit rides on it here, as the backend puts it on the jobs it launches itself.
      const retryCount = plan?.retryCount;
      const items = itemsForCells(cells, retryCount);
      const { launches, unresolved } = planGgLaunches(cells, ggOptions);
      if (
        items.length === 0 &&
        launches.length === 0 &&
        unresolved.length === 0
      ) {
        return;
      }
      setBusy(true);
      setError(null);
      try {
        // Attributed to this plan, so the jobs land inside its halt scope. Without
        // the origin they would carry `job.origin = null` and no amount of pressing
        // Halt would reach them — a plan that visibly refuses to stop.
        const batch =
          items.length > 0
            ? await launchBatch(worker, token, runtime.track, items, {
                kind: "plan",
                id: planId,
              })
            : [];
        const failed = await launchGgCells(
          worker,
          token,
          runtime.track,
          launches,
          retryCount,
        );
        // Said rather than swallowed: a trigger that enqueued four of six runs and
        // returned silently is indistinguishable from one that worked. Both endpoints
        // isolate their failures, so the partial success is the normal case.
        //
        // De-duplicated, because a cell's repeats fail identically and one sentence
        // repeated five times is not five pieces of information.
        const problems = new Set([
          ...unresolved.map((cell) => unresolvedGgProblem(cell, ggError)),
          ...batch.flatMap((result, i) => {
            const item = items[i];
            if (!result.error || !item) return [];
            const named = comboLabel({
              harness: item.track.harnessSlug,
              model: item.track.modelId,
            });
            return [`${named}: ${result.error}`];
          }),
          ...failed.map((f) => `${comboLabel(f.cell)}: ${f.error}`),
        ]);
        setError(problems.size > 0 ? [...problems].join(" ") : null);
        await refresh();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [
      worker,
      canTrigger,
      token,
      runtime.track,
      refresh,
      planId,
      plan?.retryCount,
      ggOptions,
      ggError,
    ],
  );

  // Stop filling and cancel this plan's jobs. `all` extends the sweep to jobs already
  // executing, which are partly or wholly paid for — so it is confirmed, and
  // never the control the reviewer reaches by accident.
  const halt = useCallback(
    async (all: boolean) => {
      if (!backend || !token) return;
      // Resolved (not called) through the client so the transport keeps its own
      // receiver; a transport that does not implement halting simply has no control.
      const supported = all
        ? backend.haltAllCoveragePlan
        : backend.haltCoveragePlan;
      if (!supported) return;
      if (
        all &&
        !(await confirm({
          title: "Halt everything",
          message:
            "Stop filling, and cancel every run this plan launched, including runs already executing? " +
            "Their work so far is lost and their cost is already spent. Use “Halt” " +
            "to cancel only what has not started.",
          confirmLabel: "Halt everything",
        }))
      ) {
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const result: HaltResult | undefined = all
          ? await backend.haltAllCoveragePlan?.(planId, token)
          : await backend.haltCoveragePlan?.(planId, token);
        if (result) setNote(describeHalt(result));
        // A halt always ends filling, whatever it found to cancel.
        setPlan((p) => (p ? { ...p, filling: false } : p));
        await refresh();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [backend, token, planId, refresh, confirm],
  );

  // The matrix grouped on the plan's own ordering axis, in the plan's own order.
  const groups = useMemo<MatrixGroup[]>(
    () => (coverage ? buildGroups(coverage, testCaseName) : []),
    [coverage, testCaseName],
  );

  // What filling could actually launch. A cell nothing can launch, or one blocked on
  // used-up retries, is excluded, so All missing disables itself on a plan
  // whose whole shortfall is broken rather than offering a press that could only fail.
  const deficientCells = useMemo(
    () =>
      coverage?.cells.filter(
        (c) => c.remaining > 0 && !c.unlaunchable && !c.blocked,
      ) ?? [],
    [coverage],
  );

  // The matrix is the fresher read (it is re-read on every run event); the plan's own
  // flag covers the moment before the first matrix lands.
  const filling = coverage?.filling ?? plan?.filling ?? false;
  // Only the matrix says this: it is derived from the board the matrix is read off.
  const needsAttention = filling && (coverage?.needsAttention ?? false);

  const state = useMemo<CoveragePlanState | null>(
    () =>
      coverage
        ? {
            planId,
            plan,
            coverage,
            queue,
            groups,
            deficientCells,
            busy,
            canTrigger,
            hasWorker,
            filling,
            needsAttention,
            refresh,
            fill,
            triggerCells,
            retryCell,
            halt,
          }
        : null,
    [
      planId,
      plan,
      coverage,
      queue,
      groups,
      deficientCells,
      busy,
      canTrigger,
      hasWorker,
      filling,
      needsAttention,
      refresh,
      fill,
      triggerCells,
      retryCell,
      halt,
    ],
  );

  if (!token) {
    return (
      <PageLayout>
        <header className={styles.detailHeader}>
          <div className={styles.detailTitleRow}>
            <BackChevron to={routes.accountCoverage()} label="All plans" />
            <h1 className={styles.detailTitle}>Coverage plan</h1>
          </div>
        </header>
        <p className={`${exec.notice} ${exec.warn}`}>
          Sign in to view a coverage plan. Plans are saved to your account.
        </p>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <header className={styles.detailHeader}>
        <div className={[styles.detailTitleRow, styles.dashTitleRow].join(" ")}>
          <BackChevron to={routes.accountCoverage()} label="All plans" />
          <h1 className={[styles.detailTitle, styles.dashTitle].join(" ")}>
            {plan?.name ?? planId}
          </h1>
          {needsAttention && (
            <span
              className={styles.attentionBadge}
              title={`${PLAN_ATTENTION_TITLE} Open the Tests tab to retry them.`}
            >
              {PLAN_ATTENTION_LABEL}
            </span>
          )}
        </div>
        <Link
          className={exec.secondary}
          to={routes.accountCoveragePlanEdit(planId)}
        >
          Edit plan
        </Link>
      </header>

      <PlanTabs
        tab={tab}
        planId={planId}
        unreviewed={coverage?.runsUnreviewed ?? 0}
      />

      <SubmitNotice message={error} />
      {/* The note stays a plain notice: a note that revealed itself would pull a
        reader who had scrolled down to a cell's Retry back to the top of the page. */}
      {note && <p className={`${exec.notice} ${exec.ok}`}>{note}</p>}
      {!hasWorker && (
        <p className={`${exec.notice} ${exec.warn}`}>
          No worker connected. Open the connections drawer (the gear in the top
          bar) to add a worker before launching a cell by hand. All missing
          needs no worker; the backend launches those itself.
        </p>
      )}
      {ggTrigger.notice && (
        <p className={`${exec.notice} ${exec.warn}`}>{ggTrigger.notice}</p>
      )}

      {loading ? (
        <LoadingState label="Loading coverage…" />
      ) : !state || state.coverage.cellsTotal === 0 ? (
        // Panelled like every other body this section renders: an empty plan is still
        // a surface a reviewer acts on, and its call to action has to read as one
        // rather than as a sentence lying on the backdrop.
        <Panel className={styles.emptyState}>
          <p className={styles.empty}>
            This plan is empty. Edit it to add the cases and the combinations
            you want covered — a harness with its model, or a gg configuration
            with the models it binds.
          </p>
          <Link
            className={exec.primary}
            to={routes.accountCoveragePlanEdit(planId)}
          >
            Edit this plan
          </Link>
        </Panel>
      ) : (
        <CoveragePlanContext.Provider value={state}>
          <Outlet />
        </CoveragePlanContext.Provider>
      )}
    </PageLayout>
  );
}
