import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import type { CoveragePlanSummary } from "@test-cabinet/run-record/coverage";
import { useAuth } from "../../../client/auth";
import { useBackend } from "../../../client/context";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { routes } from "../../routes";
import { AccountTabs } from "./AccountTabs";
import exec from "../runs/RunExec.module.scss";
import styles from "./Coverage.module.scss";

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
        <p className={styles.empty}>Loading plans…</p>
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
            const donePct =
              plan.cellsTotal > 0
                ? (plan.cellsSatisfied / plan.cellsTotal) * 100
                : 0;
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
                    title={`${plan.cellsSatisfied} of ${plan.cellsTotal} cells covered`}
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
