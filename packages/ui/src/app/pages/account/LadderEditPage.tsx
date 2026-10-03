import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import type {
  CoverageGroup,
  InFlightLimit,
  ReviewPlanCombo,
} from "@clockwyrks/run-record/coverage";
import type {
  Gate,
  LadderAxis,
  LadderInput,
  LadderRungInput,
} from "@clockwyrks/run-record/ladders";
import { useAuth } from "../../../client/auth";
import { useBackend } from "../../../client/context";
import type { Model } from "../../../client/types";
import { HelpTip } from "../../components/HelpTip";
import { LoadingState } from "../../components/LoadingState";
import { NumberField, useNumberFieldState } from "../../components/NumberField";
import { PageLayout } from "../../components/PageLayout";
import { BackChevron } from "../../components/BackChevron";
import { SettingRow } from "../../components/SettingRow";
import { routes } from "../../routes";
import { DEFAULT_IN_FLIGHT_LIMIT } from "./inFlightLimit";
import { ComboPicker, InFlightLimitField } from "./coveragePickers";
import {
  DEFAULT_GATE,
  GateEditor,
  LadderAxisPicker,
  RungListEditor,
  rungInput,
} from "./ladderPickers";
import { SubmitNotice } from "../../components/SubmitNotice";
import { isIneligible, useVersionEligibility } from "./rungEligibility";
import exec from "../runs/RunExec.module.scss";
import styles from "./Coverage.module.scss";

/** The run target a new ladder starts with, and the one its control resets to. */
const DEFAULT_RUNS_PER_CELL = 3;

// The ladder editor (`/account/ladders/new` and `/account/ladders/:ladderId/edit`):
// the climb (an ordered list of version-pinned rungs), the climbers (the same
// reusable combination groups a coverage plan references, plus one-offs), the single
// gate every rung is decided by, and how a dispatch of it launches its runs (climb
// order and runs in flight at once).
//
// A rung must pin a validator-rated case version, because the gate reads validator
// ratings and nothing else: the rung picker never offers a legacy version, and a rung
// the ladder already holds that is one is marked, with the save refused until it is
// replaced (the backend refuses it too, and its message is shown as it comes).
//
// A ladder is a configuration: saving it never launches or changes anything that is
// running. Run ladder, on the ladder's dashboard, starts a dispatch of the
// configuration as it stands at that moment, and an edit applies to the next Run. A
// rung whose case has a newer ingested version is flagged; a Run climbs the version
// the rung pins.
// Console-only; gated on a signed-in account.
export function LadderEditPage() {
  const { ladderId } = useParams();
  const editing = Boolean(ladderId);
  const { token } = useAuth();
  const { client: backend } = useBackend();
  const navigate = useNavigate();

  const [groups, setGroups] = useState<CoverageGroup[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  // The target every rung is climbed to. Held as the text the operator typed so the
  // field can be cleared and retyped; the save refuses while it says nothing usable.
  const runsPerCellField = useNumberFieldState(DEFAULT_RUNS_PER_CELL, {
    label: "Runs per rung",
    min: 1,
    max: 100,
    integer: true,
  });
  const runsPerCell = runsPerCellField.value ?? DEFAULT_RUNS_PER_CELL;
  const [gate, setGate] = useState<Gate>(DEFAULT_GATE);
  const [comboGroupIds, setComboGroupIds] = useState<string[]>([]);
  const [combos, setCombos] = useState<ReviewPlanCombo[]>([]);
  const [rungs, setRungs] = useState<LadderRungInput[]>([]);
  // How a dispatch launches its runs. The defaults match the wire's, so a ladder
  // created here launches exactly as one created by any other client.
  const [outerAxis, setOuterAxis] = useState<LadderAxis>("rung");
  const [inFlightLimit, setInFlightLimit] = useState<InFlightLimit | null>(
    null,
  );
  const [accountLimit, setAccountLimit] = useState<InFlightLimit>(
    DEFAULT_IN_FLIGHT_LIMIT,
  );
  // Whether a dispatch of this ladder is running, so the page can say an edit applies
  // to the next Run rather than to it.
  const [dispatchRunning, setDispatchRunning] = useState(false);

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
      editing && ladderId
        ? (backend.getLadder?.(ladderId, token) ?? Promise.resolve(null))
        : Promise.resolve(null),
    ])
      .then(([gs, existing]) => {
        if (!active) return;
        setGroups(gs);
        if (editing && !existing) {
          setError("That ladder no longer exists.");
        } else if (existing) {
          setName(existing.name);
          runsPerCellField.set(Math.max(1, existing.runsPerCell || 1));
          setGate(existing.gate);
          setComboGroupIds(existing.comboGroupIds);
          setCombos(existing.combos);
          // Carried in whole through the shared projection, ids included — that is
          // what makes a reorder or a version bump keep every climber's verdicts
          // rather than mint fresh rungs, and what stops a field this page forgot
          // from being a field the ladder loses on the next save.
          setRungs(existing.rungs.map(rungInput));
          setOuterAxis(existing.outerAxis);
          setInFlightLimit(existing.inFlightLimit ?? null);
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
    if (editing && ladderId) {
      backend
        .getLadderProgress?.(ladderId, token)
        .then(
          (board) =>
            active && setDispatchRunning(board.dispatch?.status === "running"),
        )
        .catch(() => {
          /* optional; the note simply stays away */
        });
    }
    // The account default the limit override falls back to, fetched only so the field
    // can *show* what an empty value inherits. Failing to read it must not block
    // editing the ladder, so the placeholder keeps the compiled-in fallback.
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
  }, [backend, token, editing, ladderId, runsPerCellField.set]);

  // Which rungs of the climb a ladder cannot climb at all. Known only once each rung's
  // version has resolved; one the backend does not hold is allowed, as the backend
  // allows it.
  const eligibilityOf = useVersionEligibility(rungs);
  const unclimbable = rungs.filter((r) =>
    isIneligible(eligibilityOf(r)),
  ).length;

  const comboGroups = useMemo(
    () => groups.filter((g) => g.kind === "combo"),
    [groups],
  );

  const toggleGroup = (id: string) =>
    setComboGroupIds((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );

  // A ladder needs a name, at least one rung to climb, and at least one climber —
  // whether from a referenced group or a one-off — or there is no climb to run.
  const savable =
    name.trim().length > 0 &&
    rungs.length > 0 &&
    (comboGroupIds.length > 0 || combos.length > 0) &&
    // A ladder with no run target has no climb to measure, so an emptied or
    // out-of-range field refuses the save rather than being corrected in place.
    runsPerCellField.valid &&
    // The backend refuses a rung that is not validator-rated, so the save is refused
    // here first, with the rung marked in the climb above.
    unclimbable === 0;

  async function onSave() {
    if (!token || !savable) return;
    setBusy(true);
    setError(null);
    try {
      const input: LadderInput = {
        name: name.trim(),
        runsPerCell,
        gate,
        comboGroupIds,
        combos,
        rungs,
        outerAxis,
        // Omitted when there is no override — absent means "inherit my account
        // default", a bound of 0 means "launch nothing", and no limit means "launch
        // every rung as soon as it is reached".
        ...(inFlightLimit === null ? {} : { inFlightLimit }),
      };
      if (editing && ladderId && backend?.updateLadder) {
        await backend.updateLadder(ladderId, input, token);
      } else if (backend?.createLadder) {
        await backend.createLadder(input, token);
      }
      navigate(routes.accountLadders());
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
            <BackChevron to={routes.accountLadders()} label="All ladders" />
            <h1 className={styles.detailTitle}>
              {editing ? "Ladder" : "New ladder"}
            </h1>
          </div>
        </header>
        <p className={`${exec.notice} ${exec.warn}`}>
          Sign in to edit ladders. They are saved to your account.
        </p>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <header className={styles.detailHeader}>
        <div className={styles.detailTitleRow}>
          <BackChevron to={routes.accountLadders()} label="All ladders" />
          <h1 className={styles.detailTitle}>
            {editing ? name || "Ladder" : "New ladder"}
          </h1>
        </div>
      </header>

      {loading ? (
        <LoadingState label="Loading…" />
      ) : (
        <section className={styles.editor}>
          {dispatchRunning && (
            <p className={exec.notice}>
              A dispatch of this ladder is running. Edits apply to the next Run;
              the running dispatch keeps the configuration it started with.
            </p>
          )}
          <label className={styles.nameField}>
            <span className={exec.fieldLabel}>Ladder name</span>
            <input
              className={exec.input}
              type="text"
              value={name}
              placeholder="e.g. How far up the E2E ladder?"
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <p className={`${exec.sectionLabel} ${styles.sectionBreak}`}>
            The climb
          </p>
          <RungListEditor
            rungs={rungs}
            runsPerCell={runsPerCell}
            onChange={setRungs}
          />
          <SettingRow
            label="Runs per rung"
            description="How many runs each climber does on a rung before the gate decides it."
            help="A single rung can ask for more than this with its own run count, so one pivotal step can demand more evidence than the rest of the climb."
            modified={runsPerCellField.raw !== String(DEFAULT_RUNS_PER_CELL)}
            onReset={() => runsPerCellField.set(DEFAULT_RUNS_PER_CELL)}
          >
            {(id) => (
              // The column is too narrow to read a sentence in, so the field shows
              // only its invalid state here and the action row below says why the
              // save is refused.
              <NumberField
                id={id}
                className={exec.input}
                wrapperClassName={styles.settingNumber}
                showProblem={false}
                {...runsPerCellField.bounds}
                value={runsPerCellField.raw}
                onChange={runsPerCellField.setRaw}
              />
            )}
          </SettingRow>

          <p className={`${exec.sectionLabel} ${styles.sectionBreak}`}>
            The gate
          </p>
          <GateEditor
            gate={gate}
            runsPerCell={runsPerCell}
            onChange={setGate}
          />

          <p className={`${exec.sectionLabel} ${styles.sectionBreak}`}>
            Launching runs
          </p>
          <LadderAxisPicker value={outerAxis} onChange={setOuterAxis} />
          <InFlightLimitField
            value={inFlightLimit}
            accountDefault={accountLimit}
            onChange={setInFlightLimit}
            subject="ladder"
          />
          {!editing && (
            <p className={styles.empty}>
              Saving launches nothing. Open the ladder and press Run ladder when
              you want the climb to start.
            </p>
          )}

          <p className={`${exec.sectionLabel} ${styles.sectionBreak}`}>
            Climbers{" "}
            <HelpTip text="Groups are shared with your coverage plans, so editing one reshapes both. Climbers are resolved when the ladder is run: a climber added later joins the next Run." />
          </p>
          {comboGroups.length === 0 ? (
            <p className={styles.empty}>
              No combination groups yet. Create one on the Groups tab, or pin
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
                    onClick={() => toggleGroup(g.id)}
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

          <p className={exec.sectionLabel}>One-off combinations</p>
          <ComboPicker combos={combos} onChange={setCombos} models={models} />

          <SubmitNotice message={error} />
          {/* Why the save is refused, beside the button refusing it. Static rather
              than a SubmitNotice: it is the state of the form, not the outcome of a
              press, so it must not scroll the page to itself as the operator types. */}
          {runsPerCellField.message && (
            <p className={`${exec.notice} ${exec.warn}`}>
              {runsPerCellField.message}
            </p>
          )}
          {unclimbable > 0 && (
            <p className={`${exec.notice} ${exec.warn}`}>
              {unclimbable === 1
                ? "One rung is not validator-rated"
                : `${unclimbable} rungs are not validator-rated`}
              , so this ladder cannot climb {unclimbable === 1 ? "it" : "them"}:
              a ladder&rsquo;s gate reads validator ratings, and moves on
              without anyone reviewing. Remove{" "}
              {unclimbable === 1 ? "the marked rung" : "each marked rung"} and
              add a validator-rated version of the case in its place to save.
            </p>
          )}

          <div className={styles.editorActions}>
            <button
              type="button"
              className={exec.primary}
              disabled={busy || !savable}
              onClick={onSave}
            >
              {busy ? "Saving…" : editing ? "Save ladder" : "Create ladder"}
            </button>
            <button
              type="button"
              className={exec.secondary}
              disabled={busy}
              onClick={() => navigate(routes.accountLadders())}
            >
              Cancel
            </button>
          </div>
        </section>
      )}
    </PageLayout>
  );
}
