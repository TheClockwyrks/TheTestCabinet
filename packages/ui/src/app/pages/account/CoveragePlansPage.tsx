import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import type { CoveragePlanSummary } from "@test-cabinet/run-record/coverage";
import { useAuth } from "../../../client/auth";
import { useBackend } from "../../../client/context";
import { LoadingState } from "../../components/LoadingState";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { routes } from "../../routes";
import { AccountTabs } from "./AccountTabs";
import exec from "../runs/RunExec.module.scss";
import styles from "./Coverage.module.scss";

/** One plan card's progress: run-level counts and the bar's filled fraction. */
export interface PlanProgress {
  runsDone: number;
  runsTotal: number;
  donePct: number;
}

// A plan's progress measured in *runs*, not satisfied cells. A cell only counts as
// satisfied once it has hit the target, so a cells-based bar collapses to empty the
// moment the target is raised (2 → 3 runs/cell on an already-covered plan) even
// though two thirds of the wanted runs exist. `runsMissing` is the sum of the
// per-cell shortfalls (each floored at zero), so the runs already accounted for —
// completed plus in-flight, capped at the target — are the total minus that.
export function planProgress(plan: CoveragePlanSummary): PlanProgress {
  const runsTotal = plan.cellsTotal * plan.runsPerCell;
  const runsDone = runsTotal - plan.runsMissing;
  return {
    runsDone,
    runsTotal,
    donePct: runsTotal > 0 ? (runsDone / runsTotal) * 100 : 0,
  };
}

// The Coverage tab (`/account/coverage`): the signed-in reviewer's coverage plans,
// each a card with its roll-up (cells covered / runs missing) linking to its own
// dashboard, plus create / edit / delete. Splitting the model space across several
// smaller plans keeps each dashboard — and its "Trigger all missing" — manageable.
// Console-only and gated on a signed-in account (plans are per-account).
export function CoveragePlansPage() {
  const { token } = useAuth();
  const { client: backend } = useBackend();

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
    Promise.resolve(backend.getCoveragePlansSummary?.(token) ?? [])
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
        !window.confirm(
          `Delete the plan “${name}”? This removes the plan (its groups are left ` +
            `untouched) and cannot be undone.`,
        )
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
    [backend, token, reload],
  );

  if (!token) {
    return (
      <PageLayout>
        <PromptHeader command="--coverage" comment={<>// your coverage plans</>} />
        <AccountTabs active="coverage" />
        <p className={`${exec.notice} ${exec.warn}`}>
          Sign in to use coverage plans — they are saved to your account. Use the
          account control in the top bar to register or log in.
        </p>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <div className={exec.runsHeader}>
        <PromptHeader
          command="--coverage"
          comment={<>// your coverage plans</>}
        />
        <Link className={exec.primary} to={routes.accountCoveragePlanNew()}>
          New plan
        </Link>
      </div>
      <AccountTabs active="coverage" />

      {error && <p className={`${exec.notice} ${exec.error}`}>{error}</p>}

      {loading ? (
        <LoadingState size="section" label="Loading plans…" />
      ) : !plans || plans.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.empty}>
            You have no coverage plans yet. Create one to declare the cases and
            harness/model combinations you want covered — reference reusable groups
            from the Groups tab, or pin one-off entries directly.
          </p>
          <Link className={exec.primary} to={routes.accountCoveragePlanNew()}>
            Create your first plan
          </Link>
        </div>
      ) : (
        <div className={styles.list}>
          {plans.map((plan) => {
            const { runsDone, runsTotal, donePct } = planProgress(plan);
            return (
              <div key={plan.id} className={styles.rowCard}>
                <div className={styles.rowMain}>
                  <Link
                    className={styles.rowTitleLink}
                    to={routes.accountCoveragePlan(plan.id)}
                  >
                    {plan.name}
                  </Link>
                  <span className={styles.rowSub}>
                    {plan.runsPerCell} runs/cell
                  </span>
                </div>
                <div className={styles.rowRight}>
                  <span
                    className={styles.rowProgress}
                    title={`${runsDone} of ${runsTotal} runs · ${plan.cellsSatisfied} of ${plan.cellsTotal} cells covered`}
                  >
                    <span className={styles.groupBar} aria-hidden>
                      <span
                        className={styles.groupBarDone}
                        style={{ width: `${donePct}%` }}
                      />
                    </span>
                    <span className={styles.groupCount}>
                      {plan.cellsSatisfied}/{plan.cellsTotal} · {plan.runsMissing}{" "}
                      missing
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
