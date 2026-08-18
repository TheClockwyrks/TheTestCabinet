import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import type {
  CoverageGroup,
  ReviewPlanCombo,
} from "@test-cabinet/run-record/coverage";
import type {
  Gate,
  LadderAxis,
  LadderInput,
  LadderRungInput,
} from "@test-cabinet/run-record/ladders";
import { useAuth } from "../../../client/auth";
import { useBackend } from "../../../client/context";
import type { Model } from "../../../client/types";
import { HelpTip } from "../../components/HelpTip";
import { LoadingState } from "../../components/LoadingState";
import { PageLayout } from "../../components/PageLayout";
import { BackChevron } from "../../components/BackChevron";
import { SettingRow } from "../../components/SettingRow";
import { Switch } from "../../components/Switch";
import { routes } from "../../routes";
import { BufferTargetField, ComboPicker } from "./coveragePickers";
import {
  DEFAULT_GATE,
  GateEditor,
  LadderAxisPicker,
  RungListEditor,
} from "./ladderPickers";
import exec from "../runs/RunExec.module.scss";
import styles from "./Coverage.module.scss";

// The backend's compiled-in review-buffer default, shown as the placeholder until the
// account's own setting resolves. Only ever a display fallback: the number that
// actually applies is whatever `GET /coverage-settings` reports, and an empty override
// field defers to it rather than to this.
const FALLBACK_BUFFER_TARGET = 10;

/** The run target a new ladder starts with, and the one its control resets to. */
const DEFAULT_RUNS_PER_CELL = 3;

// The ladder editor (`/account/ladders/new` and `/account/ladders/:ladderId/edit`):
// the climb (an ordered list of version-pinned rungs), the climbers (the same
// reusable combination groups a coverage plan references, plus one-offs), the single
// gate every rung is judged by, and how the ladder is fed (climb order, review
// buffer, auto-top-up).
//
// Rungs are reconciled on their stable ids by the save, so reordering the climb or
// bumping a rung's version here keeps every climber's recorded verdicts attached to
// the case that earned them. Enabling and halting — the two controls that decide
// whether the ladder spends anything — are deliberately not here: they belong beside
// the board that shows what would be started or cancelled. Saving here never enqueues,
// and a ladder created here is created disabled.
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
  const [runsPerCell, setRunsPerCell] = useState(DEFAULT_RUNS_PER_CELL);
  const [gate, setGate] = useState<Gate>(DEFAULT_GATE);
  const [comboGroupIds, setComboGroupIds] = useState<string[]>([]);
  const [combos, setCombos] = useState<ReviewPlanCombo[]>([]);
  const [rungs, setRungs] = useState<LadderRungInput[]>([]);
  // How the ladder is fed. The defaults match the wire's, so a ladder created here is
  // fed exactly as one created by any other client.
  const [outerAxis, setOuterAxis] = useState<LadderAxis>("rung");
  const [autoTopUp, setAutoTopUp] = useState(true);
  const [bufferTarget, setBufferTarget] = useState<number | null>(null);
  const [accountBuffer, setAccountBuffer] = useState(FALLBACK_BUFFER_TARGET);
  // Whether the ladder was enabled when this form loaded. Not state, because nothing
  // here renders or edits it: it is only the fallback for the save's read-back below,
  // for a transport that cannot re-read a schedule on its own. A ladder being created
  // has none, and is created disabled.
  const loadedPaused = useRef(true);

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
          setRunsPerCell(Math.max(1, existing.runsPerCell || 1));
          setGate(existing.gate);
          setComboGroupIds(existing.comboGroupIds);
          setCombos(existing.combos);
          // Carried in with their ids, which is what makes a reorder or a version
          // bump keep every climber's verdicts rather than mint fresh rungs.
          setRungs(
            existing.rungs.map((rung) => ({
              id: rung.id,
              slug: rung.slug,
              version: rung.version,
              variant: rung.variant,
              ...(rung.runs === undefined ? {} : { runs: rung.runs }),
            })),
          );
          setOuterAxis(existing.outerAxis);
          setAutoTopUp(existing.autoTopUp);
          setBufferTarget(existing.bufferTarget ?? null);
          loadedPaused.current = existing.paused;
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
    // The account default the buffer override falls back to, fetched only so the field
    // can *show* what an empty value inherits. Failing to read it must not block
    // editing the ladder, so the placeholder keeps the compiled-in fallback.
    backend
      .getCoverageSettings?.(token)
      .then((s) => active && setAccountBuffer(s.bufferTarget))
      .catch(() => {
        /* optional; the placeholder stays the compiled-in default */
      });
    return () => {
      active = false;
    };
  }, [backend, token, editing, ladderId]);

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
    (comboGroupIds.length > 0 || combos.length > 0);

  async function onSave() {
    if (!token || !savable) return;
    setBusy(true);
    setError(null);
    try {
      // Whether the ladder is enabled is not a setting of this page — it is the
      // dashboard's control, beside the board that shows what enabling would start —
      // but the schedule is written whole, so the flag has to be carried. It is read
      // back **here**, at save time, rather than held from the load: an edit that
      // takes ten minutes must not re-assert the state the ladder was in when the
      // form opened, and so quietly re-enable a ladder its reviewer has since
      // disabled. A new ladder is always created disabled.
      const paused =
        editing && ladderId
          ? ((await backend?.getLadderSchedule?.(ladderId, token))?.paused ??
            loadedPaused.current)
          : true;
      const input: LadderInput = {
        name: name.trim(),
        runsPerCell,
        gate,
        comboGroupIds,
        combos,
        rungs,
        schedule: {
          outerAxis,
          paused,
          autoTopUp,
          // Omitted rather than sent as 0 when there is no override — null means
          // "inherit my account default", 0 means "never top this ladder up".
          ...(bufferTarget === null ? {} : { bufferTarget }),
        },
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
          Sign in to edit ladders — they are saved to your account.
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

      {error && <p className={`${exec.notice} ${exec.error}`}>{error}</p>}

      {loading ? (
        <LoadingState label="Loading…" />
      ) : (
        <section className={styles.editor}>
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

          <p className={exec.sectionLabel}>The climb</p>
          <RungListEditor
            rungs={rungs}
            runsPerCell={runsPerCell}
            onChange={setRungs}
          />
          <SettingRow
            label="Runs per rung"
            description="How many runs each climber does on a rung before the gate decides it."
            help="A single rung can ask for more than this with its own run count, so one pivotal step can demand more evidence than the rest of the climb."
            modified={runsPerCell !== DEFAULT_RUNS_PER_CELL}
            onReset={() => setRunsPerCell(DEFAULT_RUNS_PER_CELL)}
          >
            {(id) => (
              <span className={styles.settingNumber}>
                <input
                  id={id}
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
              </span>
            )}
          </SettingRow>

          <p className={exec.sectionLabel}>The gate</p>
          <GateEditor
            gate={gate}
            runsPerCell={runsPerCell}
            onChange={setGate}
          />

          <p className={exec.sectionLabel}>Feeding the ladder</p>
          <LadderAxisPicker value={outerAxis} onChange={setOuterAxis} />
          <BufferTargetField
            value={bufferTarget}
            accountDefault={accountBuffer}
            onChange={setBufferTarget}
            subject="ladder"
          />
          <SettingRow
            label="Top this ladder up when I submit a review"
            description="Each review submitted enqueues more of the rung every climber is currently on, up to the review buffer."
            help="On by default, and it only applies once the ladder is enabled: a review is the verdict that decides a rung, so it is the moment the next runs should be asked for. Turn it off to feed the ladder only with “Top up now”."
            modified={!autoTopUp}
            onReset={() => setAutoTopUp(true)}
          >
            {(id) => (
              <Switch id={id} checked={autoTopUp} onChange={setAutoTopUp} />
            )}
          </SettingRow>
          {!editing && (
            <p className={styles.empty}>
              A new ladder starts disabled and enqueues nothing. Enable it from
              its dashboard when you want the climb to start.
            </p>
          )}

          <p className={exec.sectionLabel}>
            Climbers{" "}
            <HelpTip text="Groups are shared with your coverage plans, so editing one reshapes both. A climber added to a standing ladder starts at rung one while the others carry on from where they had got to." />
          </p>
          {comboGroups.length === 0 ? (
            <p className={styles.empty}>
              No model groups yet. Create one on the Groups tab, or pin one-off
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

          <p className={exec.sectionLabel}>
            One-off harness / model combinations
          </p>
          <ComboPicker combos={combos} onChange={setCombos} models={models} />

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
