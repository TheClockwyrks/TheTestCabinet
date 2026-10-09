import type {
  CoverageAxis,
  CoverageGroup,
  CoveragePlanInput,
  CoveragePlanOut,
  InFlightLimit,
  ReviewPlanCase,
  ReviewPlanCombo,
} from "@clockwyrks/backend-api/coverage";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { LoadingState } from "../../components/LoadingState";
import { NumberField, useNumberFieldState } from "../../components/NumberField";
import { useAuth } from "../../../client/auth";
import { useBackend } from "../../../client/context";
import type { Model } from "../../../client/types";
import { PageLayout } from "../../components/PageLayout";
import { BackChevron } from "../../components/BackChevron";
import { SettingRow } from "../../components/SettingRow";
import { routes } from "../../routes";
import {
  AxisPicker,
  InFlightLimitField,
  ComboPicker,
  CasePicker,
  DEFAULT_COVERAGE_AXIS,
} from "./coveragePickers";
import { DEFAULT_IN_FLIGHT_LIMIT } from "./inFlightLimit";
import { SubmitNotice } from "../../components/SubmitNotice";
import exec from "../runs/RunExec.module.scss";
import styles from "./Coverage.module.scss";

/** The run target a new plan starts with, and the one its control resets to. */
const DEFAULT_RUNS_PER_CELL = 3;

// The coverage plan editor (`/account/coverage/new` and `/account/coverage/:planId/
// edit`): name, runs-per-cell, how the plan is filled (run order, runs-in-flight
// limit), the reusable groups the plan references, and any one-off
// combinations/cases pinned directly. Referenced groups are pointers — editing a
// group later reshapes this plan — while one-offs live on the plan. Save creates or
// updates and returns to the plans list. Console-only; gated on a signed-in account.
//
// A plan is a standing matrix, so a save applies at once: a plan that is filling
// launches whatever cells the edit added. Saving never starts or stops filling; that
// is the dashboard's All missing and Halt.
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
  // The target every cell is filled to. Held as the text the operator typed so the
  // field can be cleared and retyped; the save refuses while it says nothing usable.
  const runsPerCellField = useNumberFieldState(DEFAULT_RUNS_PER_CELL, {
    label: "Runs per cell",
    min: 1,
    max: 100,
    integer: true,
  });
  const runsPerCell = runsPerCellField.value ?? DEFAULT_RUNS_PER_CELL;
  const [comboGroupIds, setComboGroupIds] = useState<string[]>([]);
  const [caseGroupIds, setCaseGroupIds] = useState<string[]>([]);
  const [combos, setCombos] = useState<ReviewPlanCombo[]>([]);
  const [cases, setCases] = useState<ReviewPlanCase[]>([]);
  // How the plan is filled: the order its cells launch in, and its override of the
  // account's runs-in-flight limit (null inherits it).
  const [outerAxis, setOuterAxis] = useState<CoverageAxis>(
    DEFAULT_COVERAGE_AXIS,
  );
  const [inFlightLimit, setInFlightLimit] = useState<InFlightLimit | null>(
    null,
  );
  const [accountLimit, setAccountLimit] = useState<InFlightLimit>(
    DEFAULT_IN_FLIGHT_LIMIT,
  );

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
            runsPerCellField.set(Math.max(1, plan.runsPerCell || 1));
            setComboGroupIds(plan.comboGroupIds);
            setCaseGroupIds(plan.caseGroupIds);
            setCombos(plan.combos);
            setCases(plan.cases);
            setOuterAxis(plan.outerAxis);
            setInFlightLimit(plan.inFlightLimit ?? null);
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
    // The account default the limit override falls back to, fetched only so the
    // field can *show* what an empty value inherits. Failing to read it must not
    // block editing the plan, so the placeholder simply keeps the compiled-in
    // fallback.
    backend
      .getCoverageSettings?.(token)
      .then((s) => active && setAccountLimit(s.inFlightLimit))
      .catch(() => {
        /* optional; the placeholder stays the compiled-in default */
      });
    return () => {
      active = false;
    };
    // `runsPerCellField.set` is referentially stable (see components/NumberField).
  }, [backend, token, editing, planId, runsPerCellField.set]);

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
    (caseGroupIds.length > 0 || cases.length > 0) &&
    // A plan with no run target fills nothing, so an emptied or out-of-range field
    // refuses the save rather than being corrected in place.
    runsPerCellField.valid;

  async function onSave() {
    if (!token || !savable) return;
    const input: CoveragePlanInput = {
      name: name.trim(),
      runsPerCell,
      comboGroupIds,
      caseGroupIds,
      combos,
      cases,
      outerAxis,
      // Omitted when there is no override — absent means "inherit my account
      // default", a bound of 0 means "launch nothing", and no limit means
      // "everything at once".
      ...(inFlightLimit === null ? {} : { inFlightLimit }),
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
          Sign in to edit coverage plans. They are saved to your account.
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

          {/* Runs-per-cell sits with the filling rather than with the members it
              multiplies: it is the target every cell is filled toward, so it is read
              alongside the limit that decides how much of it runs at once. */}
          <p className={exec.sectionLabel}>Filling the plan</p>
          <SettingRow
            label="Runs per cell"
            description="How many runs every combination does on every case in the matrix."
            help="A cell is one combination on one case. Raising this lengthens the plan rather than starting more runs at once — the runs-in-flight limit is what caps how many run together. Raise it later for more evidence; filling launches only the new shortfall."
            modified={runsPerCellField.raw !== String(DEFAULT_RUNS_PER_CELL)}
            onReset={() => runsPerCellField.set(DEFAULT_RUNS_PER_CELL)}
          >
            {(id) => (
              // The column is too narrow to read a sentence in, so the field shows
              // only its invalid state here and the action row below says why the
              // save is refused.
              <NumberField
                id={id}
                wrapperClassName={styles.settingNumber}
                showProblem={false}
                {...runsPerCellField.bounds}
                value={runsPerCellField.raw}
                onChange={runsPerCellField.setRaw}
              />
            )}
          </SettingRow>
          <AxisPicker value={outerAxis} onChange={setOuterAxis} />
          <InFlightLimitField
            value={inFlightLimit}
            accountDefault={accountLimit}
            onChange={setInFlightLimit}
          />

          <p className={exec.sectionLabel}>Combination groups</p>
          {comboGroups.length === 0 ? (
            <p className={styles.empty}>
              No combination groups yet. Create some on the Groups tab, or pin
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
              No case groups yet. Create some on the Groups tab, or pin one-off
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

          <p className={exec.sectionLabel}>One-off combinations</p>
          <ComboPicker combos={combos} onChange={setCombos} models={models} />

          <p className={exec.sectionLabel}>One-off test cases</p>
          <CasePicker cases={cases} onChange={setCases} />

          <SubmitNotice message={error} />
          {/* Why the save is refused, beside the button refusing it. Static rather
              than a SubmitNotice: it is the state of the form, not the outcome of a
              press, so it must not scroll the page to itself as the operator types. */}
          {runsPerCellField.message && (
            <p className={`${exec.notice} ${exec.warn}`}>
              {runsPerCellField.message}
            </p>
          )}

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
