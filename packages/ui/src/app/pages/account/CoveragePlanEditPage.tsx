import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { LoadingState } from "../../components/LoadingState";
import type {
  CoverageAxis,
  CoverageGroup,
  CoveragePlanInput,
  CoveragePlanOut,
  ReviewPlanCase,
  ReviewPlanCombo,
} from "@test-cabinet/run-record/coverage";
import { useAuth } from "../../../client/auth";
import { useBackend } from "../../../client/context";
import type { Model } from "../../../client/types";
import { PageLayout } from "../../components/PageLayout";
import { BackChevron } from "../../components/BackChevron";
import { routes } from "../../routes";
import {
  AxisPicker,
  BufferTargetField,
  ComboPicker,
  CasePicker,
} from "./coveragePickers";
import exec from "../runs/RunExec.module.scss";
import styles from "./Coverage.module.scss";

// The backend's compiled-in review-buffer default, shown as the placeholder until
// the account's own setting resolves. Only ever a display fallback: the number that
// actually applies is whatever `GET /coverage-settings` reports, and an empty
// override field defers to it rather than to this.
const FALLBACK_BUFFER_TARGET = 10;

// The coverage plan editor (`/account/coverage/new` and `/account/coverage/:planId/
// edit`): name, runs-per-cell, how the plan is fed (run order, review buffer,
// auto-top-up), the reusable groups the plan references, and any one-off
// combinations/cases pinned directly. Referenced groups are pointers — editing a
// group later reshapes this plan — while one-offs live on the plan. Save creates or
// updates and returns to the plans list. Console-only; gated on a signed-in account.
//
// The schedule fields travel in the save body's nested `schedule`, and the plan's
// `paused` state is carried through untouched from what was loaded: pausing and
// halting are the dashboard's controls, and saving an edited member list here must
// never resume a plan somebody deliberately stopped.
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
  // How the plan is fed. `outerAxis`/`autoTopUp` default to today's behaviour so a
  // plan created here is fed exactly as one created before this existed.
  const [outerAxis, setOuterAxis] = useState<CoverageAxis>("case");
  const [autoTopUp, setAutoTopUp] = useState(false);
  const [bufferTarget, setBufferTarget] = useState<number | null>(null);
  // Carried, never edited here — see the note on this page's purpose above.
  const [paused, setPaused] = useState(false);
  const [accountBuffer, setAccountBuffer] = useState(FALLBACK_BUFFER_TARGET);

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
        : Promise.resolve<CoveragePlanOut[]>([]),
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
            setOuterAxis(plan.outerAxis);
            setAutoTopUp(plan.autoTopUp);
            setBufferTarget(plan.bufferTarget ?? null);
            setPaused(plan.paused);
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
    // The account default the buffer override falls back to, fetched only so the
    // field can *show* what an empty value inherits. Failing to read it must not
    // block editing the plan, so the placeholder simply keeps the compiled-in
    // fallback.
    backend
      .getCoverageSettings?.(token)
      .then((s) => active && setAccountBuffer(s.bufferTarget))
      .catch(() => {
        /* optional; the placeholder stays the compiled-in default */
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
      schedule: {
        outerAxis,
        // Whatever the plan was loaded as (false for a new plan): the dashboard owns
        // this control, and a member edit is not a decision to resume.
        paused,
        autoTopUp,
        // Omitted rather than sent as 0 when there is no override — null means
        // "inherit my account default", 0 means "never top this plan up".
        ...(bufferTarget === null ? {} : { bufferTarget }),
      },
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
        <LoadingState label="Loading…" />
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

          <p className={exec.sectionLabel}>Run order</p>
          <AxisPicker value={outerAxis} onChange={setOuterAxis} />

          <BufferTargetField
            value={bufferTarget}
            accountDefault={accountBuffer}
            onChange={setBufferTarget}
          />
          <label className={styles.controlToggle}>
            <input
              type="checkbox"
              checked={autoTopUp}
              onChange={(e) => setAutoTopUp(e.target.checked)}
            />
            Top up this plan when I submit a review
          </label>
          <p className={styles.fieldHint}>
            A top-up walks the cells in the order above, skips the ones already
            at their target, and enqueues whole cases at a time until the buffer
            is full — so a case&rsquo;s repeats arrive together and can be
            reviewed against each other. Pausing and halting live on the
            plan&rsquo;s dashboard.
          </p>

          <p className={exec.sectionLabel}>Model groups</p>
          {comboGroups.length === 0 ? (
            <p className={styles.empty}>
              No model groups yet — create some on the Groups tab, or pin
              one-off combinations below.
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
                    onClick={() =>
                      toggle(g.id, comboGroupIds, setComboGroupIds)
                    }
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

          <p className={exec.sectionLabel}>
            One-off harness / model combinations
          </p>
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
