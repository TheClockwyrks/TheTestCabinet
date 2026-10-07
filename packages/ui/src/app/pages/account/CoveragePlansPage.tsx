import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import type { CoveragePlanSummary } from "@clockwyrks/run-record/coverage";
import { useAuth } from "../../../client/auth";
import { useBackend } from "../../../client/context";
import { LoadingState } from "../../components/LoadingState";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { useConfirm } from "../../components/ConfirmDialog";
import { routes } from "../../routes";
import { AccountTabs } from "./AccountTabs";
import { SubmitNotice } from "../../components/SubmitNotice";
import exec from "../runs/RunExec.module.scss";
import styles from "./Coverage.module.scss";

/** One plan card's progress: run-level counts, the bar's filled fraction, and the
 *  bar's hover text. */
export interface PlanProgress {
  runsDone: number;
  runsTotal: number;
  donePct: number;
  /** The run detail the bar's hover text gives. */
  title: string;
}

// A plan's progress measured in *runs*, not filled cells: a cell only counts as
// filled once it has hit its target, so a cells-based bar would collapse to empty the
// moment the target is raised (2 → 3 runs/cell on an already-covered plan) even
// though two thirds of the wanted runs exist. `runsDone` is the runs that count,
// capped at each cell's target, so the bar fills as runs finish and never overflows.
// The text beside the bar is the cells filled; the run detail rides in the hover.
export function planProgress(plan: CoveragePlanSummary): PlanProgress {
  const { runsDone, runsTotal } = plan;
  let title =
    `${runsDone} of ${runsTotal} runs done · ${plan.runsInFlight} launched and in flight · ` +
    `${plan.runsMissing} to launch`;
  if (plan.cellsBlocked > 0) title += ` · ${plan.cellsBlocked} blocked`;
  return {
    runsDone,
    runsTotal,
    donePct: runsTotal > 0 ? Math.min(100, (runsDone / runsTotal) * 100) : 0,
    title,
  };
}

// The Coverage tab (`/account/coverage`): the signed-in reviewer's coverage plans,
// each a card with its runs per cell, a bar of the runs done and the cells filled,
// linking to its own dashboard, plus create / edit / delete. The account-wide
// runs-in-flight limit every plan inherits lives in Settings → Runs. Splitting the
// model space across several smaller plans keeps each dashboard manageable.
// Console-only and gated on a signed-in account (plans are per-account).
export function CoveragePlansPage() {
  const { token } = useAuth();
  const { client: backend } = useBackend();
  const { confirm } = useConfirm();

  const [plans, setPlans] = useState<CoveragePlanSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!backend?.getCoveragePlansSummary || !token) return;
    setPlans(await backend.getCoveragePlansSummary(token));
  }, [backend, token]);

  useEffect(() => {
    if (!backend || !token) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    (backend.getCoveragePlansSummary?.(token) ?? Promise.resolve([]))
      .then((p) => {
        if (!active) return;
        setPlans(p);
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

  const deletePlan = useCallback(
    async (id: string, name: string) => {
      if (!backend?.deleteCoveragePlan || !token) return;
      if (
        !(await confirm({
          title: "Delete plan",
          message:
            `Delete the plan “${name}”? This removes the plan (its groups are left ` +
            `untouched) and cannot be undone.`,
          confirmLabel: "Delete plan",
        }))
      ) {
        return;
      }
      setBusy(true);
      setError(null);
      try {
        await backend.deleteCoveragePlan(id, token);
        await reload();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [backend, token, reload, confirm],
  );

  if (!token) {
    return (
      <PageLayout>
        <PromptHeader
          command="--coverage"
          comment={<>// your coverage plans</>}
        />
        <AccountTabs active="coverage" />
        <p className={`${exec.notice} ${exec.warn}`}>
          Sign in to use coverage plans. They are saved to your account. Use the
          account control in the top bar to register or log in.
        </p>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <PromptHeader
        command="--coverage"
        comment={<>// your coverage plans</>}
        titleActions={
          <Link className={exec.primary} to={routes.accountCoveragePlanNew()}>
            + New plan
          </Link>
        }
      />
      <AccountTabs active="coverage" />

      <SubmitNotice message={error} />

      {loading ? (
        <LoadingState size="section" label="Loading plans…" />
      ) : !plans || plans.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.empty}>
            You have no coverage plans yet. Create one to declare the cases and
            the combinations you want covered — a harness with its model, or a
            gg configuration with the models it binds. Reference reusable groups
            from the Groups tab, or pin one-off entries directly.
          </p>
          <Link className={exec.primary} to={routes.accountCoveragePlanNew()}>
            Create your first plan
          </Link>
        </div>
      ) : (
        <div className={styles.list}>
          {plans.map((plan) => {
            const { donePct, title } = planProgress(plan);
            return (
              <div key={plan.id} className={styles.rowCard}>
                <div className={styles.rowMain}>
                  <span className={styles.rowTitleRow}>
                    <Link
                      className={styles.rowTitleLink}
                      to={routes.accountCoveragePlan(plan.id)}
                    >
                      {plan.name}
                    </Link>
                  </span>
                  <span className={styles.rowSub}>
                    {`${plan.runsPerCell} run${plan.runsPerCell === 1 ? "" : "s"}/cell`}
                  </span>
                </div>
                <div className={styles.rowRight}>
                  <span className={styles.rowProgress} title={title}>
                    <span className={styles.groupBar} aria-hidden>
                      <span
                        className={styles.groupBarDone}
                        style={{ width: `${donePct}%` }}
                      />
                    </span>
                    <span className={styles.groupCount}>
                      {plan.cellsFilled}/{plan.cellsTotal} cells
                    </span>
                  </span>
                  <span className={styles.rowActions}>
                    <Link
                      className={exec.secondary}
                      to={routes.accountCoveragePlanEdit(plan.id)}
                    >
                      Edit
                    </Link>
                    <button
                      type="button"
                      className={exec.danger}
                      disabled={busy}
                      onClick={() => deletePlan(plan.id, plan.name)}
                    >
                      Delete
                    </button>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </PageLayout>
  );
}
