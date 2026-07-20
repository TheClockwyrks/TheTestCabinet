import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import type {
  CoverageGroup,
  CoveragePlan,
  CoveragePlanInput,
  ReviewPlanCase,
  ReviewPlanCombo,
} from "@test-cabinet/run-record/coverage";
import { useAuth } from "../../../client/auth";
import { useBackend } from "../../../client/context";
import type { Model } from "../../../client/types";
import { PageLayout } from "../../components/PageLayout";
import { BackChevron } from "../../components/BackChevron";
import { routes } from "../../routes";
import { ComboPicker, CasePicker } from "./coveragePickers";
import exec from "../runs/RunExec.module.scss";
import styles from "./Coverage.module.scss";

// The coverage plan editor (`/account/coverage/new` and `/account/coverage/:planId/
// edit`): name, runs-per-cell, the reusable groups the plan references, and any
// one-off combinations/cases pinned directly. Referenced groups are pointers —
// editing a group later reshapes this plan — while one-offs live on the plan. Save
// creates or updates and returns to the plans list. Console-only; gated on a
// signed-in account.
export function CoveragePlanEditPage() {
  const { planId } = useParams();
  const editing = Boolean(planId);
  const { token } = useAuth();
  const { client: backend } = useBackend();
  const navigate = useNavigate();

  const [groups, setGroups] = useState<CoverageGroup[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [runsPerCell, setRunsPerCell] = useState(3);
  const [comboGroupIds, setComboGroupIds] = useState<string[]>([]);
  const [caseGroupIds, setCaseGroupIds] = useState<string[]>([]);
  const [combos, setCombos] = useState<ReviewPlanCombo[]>([]);
  const [cases, setCases] = useState<ReviewPlanCase[]>([]);

  useEffect(() => {
    if (!backend || !token) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([
      backend.listCoverageGroups?.(token) ?? Promise.resolve([]),
      editing
        ? (backend.listCoveragePlans?.(token) ?? Promise.resolve([]))
        : Promise.resolve<CoveragePlan[]>([]),
    ])
      .then(([gs, plans]) => {
        if (!active) return;
        setGroups(gs);
        if (editing) {
          const plan = plans.find((p) => p.id === planId);
          if (!plan) {
            setError("That plan no longer exists.");
          } else {
            setName(plan.name);
            setRunsPerCell(Math.max(1, plan.runsPerCell || 1));
            setComboGroupIds(plan.comboGroupIds);
            setCaseGroupIds(plan.caseGroupIds);
            setCombos(plan.combos);
            setCases(plan.cases);
          }
        }
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
  }, [backend, token, editing, planId]);

  const comboGroups = useMemo(
    () => groups.filter((g) => g.kind === "combo"),
    [groups],
  );
  const caseGroupsList = useMemo(
    () => groups.filter((g) => g.kind === "case"),
    [groups],
  );

  const toggle = (
    id: string,
    ids: string[],
    setIds: (next: string[]) => void,
  ) => setIds(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);

  // A plan needs a name and at least one combination source and one case source —
  // whether from a referenced group or a one-off — or it can produce no cells.
  const savable =
    name.trim().length > 0 &&
    (comboGroupIds.length > 0 || combos.length > 0) &&
    (caseGroupIds.length > 0 || cases.length > 0);

  async function onSave() {
    if (!token || !savable) return;
    const input: CoveragePlanInput = {
      name: name.trim(),
      runsPerCell,
      comboGroupIds,
      caseGroupIds,
      combos,
      cases,
    };
    setBusy(true);
    setError(null);
    try {
      if (editing && planId && backend?.updateCoveragePlan) {
        await backend.updateCoveragePlan(planId, input, token);
      } else if (backend?.createCoveragePlan) {
        await backend.createCoveragePlan(input, token);
      }
      navigate(routes.accountCoverage());
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <PageLayout>
        <header className={styles.detailHeader}>
          <div className={styles.detailTitleRow}>
            <BackChevron to={routes.accountCoverage()} label="All plans" />
            <h1 className={styles.detailTitle}>
              {editing ? "Coverage plan" : "New plan"}
            </h1>
          </div>
        </header>
        <p className={`${exec.notice} ${exec.warn}`}>
          Sign in to edit coverage plans — they are saved to your account.
        </p>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <header className={styles.detailHeader}>
        <div className={styles.detailTitleRow}>
          <BackChevron to={routes.accountCoverage()} label="All plans" />
          <h1 className={styles.detailTitle}>
            {editing ? name || "Coverage plan" : "New plan"}
          </h1>
        </div>
      </header>

      {error && <p className={`${exec.notice} ${exec.error}`}>{error}</p>}

      {loading ? (
        <p className={styles.empty}>Loading…</p>
      ) : (
        <section className={styles.editor}>
          <label className={styles.nameField}>
            <span className={exec.fieldLabel}>Plan name</span>
            <input
              className={exec.input}
              type="text"
              value={name}
              placeholder="e.g. Anthropic / E2E"
              onChange={(e) => setName(e.target.value)}
            />
          </label>

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

          <p className={exec.sectionLabel}>Model groups</p>
          {comboGroups.length === 0 ? (
            <p className={styles.empty}>
              No model groups yet — create some on the Groups tab, or pin one-off
              combinations below.
            </p>
          ) : (
            <div className={styles.groupPicks}>
              {comboGroups.map((g) => {
                const on = comboGroupIds.includes(g.id);
                return (
                  <button
                    key={g.id}
                    type="button"
                    className={`${styles.groupPick} ${on ? styles.groupPickOn : ""}`}
                    aria-pressed={on}
                    onClick={() => toggle(g.id, comboGroupIds, setComboGroupIds)}
                  >
                    {g.name}
                    <span className={styles.groupPickCount}>
                      {g.combos.length}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <p className={exec.sectionLabel}>Case groups</p>
          {caseGroupsList.length === 0 ? (
            <p className={styles.empty}>
              No case groups yet — create some on the Groups tab, or pin one-off
              cases below.
            </p>
          ) : (
            <div className={styles.groupPicks}>
              {caseGroupsList.map((g) => {
                const on = caseGroupIds.includes(g.id);
                return (
                  <button
                    key={g.id}
                    type="button"
                    className={`${styles.groupPick} ${on ? styles.groupPickOn : ""}`}
                    aria-pressed={on}
                    onClick={() => toggle(g.id, caseGroupIds, setCaseGroupIds)}
                  >
                    {g.name}
                    <span className={styles.groupPickCount}>
                      {g.cases.length}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <p className={exec.sectionLabel}>One-off harness / model combinations</p>
          <ComboPicker combos={combos} onChange={setCombos} models={models} />

          <p className={exec.sectionLabel}>One-off test cases</p>
          <CasePicker cases={cases} onChange={setCases} />

          <div className={styles.editorActions}>
            <button
              type="button"
              className={exec.primary}
              disabled={busy || !savable}
              onClick={onSave}
            >
              {busy ? "Saving…" : editing ? "Save plan" : "Create plan"}
            </button>
            <button
              type="button"
              className={exec.secondary}
              disabled={busy}
              onClick={() => navigate(routes.accountCoverage())}
            >
              Cancel
            </button>
          </div>
        </section>
      )}
    </PageLayout>
  );
}
