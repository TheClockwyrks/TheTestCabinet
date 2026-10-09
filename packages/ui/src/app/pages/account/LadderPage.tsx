import type {
  CoverageQueue,
  HaltResult,
  ReviewPlanCombo,
} from "@clockwyrks/backend-api/coverage";
import type {
  ClimberBlock,
  DispatchStatus,
  Ladder,
  LadderClimber,
  LadderProgress,
  LadderProgressRung,
  LadderRung,
  LadderSlot,
  RungTally,
  SlotStatus,
} from "@clockwyrks/backend-api/ladders";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useAuth } from "../../../client/auth";
import { useBackend } from "../../../client/context";
import { LoadingState } from "../../components/LoadingState";
import { PageLayout } from "../../components/PageLayout";
import { BackChevron } from "../../components/BackChevron";
import { useConfirm } from "../../components/ConfirmDialog";
import { useRecordSectionIndex } from "../../components/backReturn";
import { useTestCaseName } from "../../data/useTestCaseName";
import { useRunsRuntime } from "../../runtime/runsRuntime";
import { useLiveRunUpdates } from "../../runtime/useLiveRunUpdates";
import { routes } from "../../routes";
import { CoverageReviewQueue } from "./CoverageReviewQueue";
import { formatInFlightLimit, inFlightStatTitle } from "./inFlightLimit";
import { comboLabel } from "./comboLabels";
import { caseLabel } from "./caseLabels";
import { RungRuns } from "./LadderRungRuns";
import { ladderAxisLabel } from "./ladderPickers";
import { SubmitNotice } from "../../components/SubmitNotice";
import exec from "../runs/RunExec.module.scss";
import styles from "./Coverage.module.scss";
import ladderStyles from "./Ladder.module.scss";

// The ladder dashboard is the point of the whole feature: one card per climber, each
// saying how far that model got and where it stands now. The status pill, the rung
// track, and the counts are readable at a glance; the per-rung evidence is what an
// expanded card adds.
//
// A ladder is a configuration that does nothing by itself. Run ladder starts a
// **dispatch** of it as it stands at that moment: every climber starts on rung 1, the
// validators rate every completed run, the gate reads those ratings, and the backend
// launches each climber's next rung itself as runs finish. The dispatch owns its runs
// and its standing until the next Run replaces it; the runs themselves stay in the run
// list like any other. A climber failing a rung is the ladder's result for that model,
// so nothing on this board changes a verdict, and the review queue is there only for
// labelling runs after the fact.

/** The badge text for each rung-slot status. */
export const SLOT_BADGE_LABEL: Record<SlotStatus, string> = {
  running: "Running",
  blocked: "Blocked",
  passed: "Passed",
  failed: "Failed",
  pending: "Pending",
  skipped: "Skipped",
};

/** How a ladder's latest dispatch reads: the header's badge and the list card's. */
export function dispatchStatusLabel(status: DispatchStatus | null): string {
  switch (status) {
    case null:
      return "Not run yet";
    case "running":
      return "Running";
    case "finished":
      return "Finished";
    case "stopped":
      return "Stopped";
  }
}

/**
 * Where a climber stands, in one phrase. Every state but a completed climb names its
 * rung, counted from one for the reader (the wire counts positions from zero),
 * because "failed" alone is the same sentence for a model that fell at the first case
 * and one that passed six. Under a stopped dispatch a climber that was still climbing
 * reads as stopped where it stood.
 */
export function climberStatusLabel(
  climber: LadderClimber,
  rungCount: number,
  dispatch: DispatchStatus = "running",
): string {
  const at = (climber.currentRung ?? rungCount - 1) + 1;
  if (
    dispatch === "stopped" &&
    (climber.status === "running" || climber.status === "blocked")
  ) {
    return `Stopped at rung ${at}`;
  }
  switch (climber.status) {
    case "running":
      return `Running rung ${at}`;
    case "blocked":
      return blockedLabel(climber.blocked, at);
    case "failed":
      return `Failed at rung ${at}`;
    case "completed":
      return "Completed";
  }
}

/**
 * The status pill of a blocked climber: where it is stuck, and the kind of fault in a
 * few words. The full reason and its fix are on the line under the card's header.
 */
function blockedLabel(block: ClimberBlock | undefined, at: number): string {
  switch (block?.kind) {
    case "unlaunchable":
      return `Blocked at rung ${at}: cannot launch`;
    case "failing":
      return `Blocked at rung ${at}: runs keep failing`;
    case "unrated":
      return `Blocked at rung ${at}: ${block.runs} run${block.runs === 1 ? "" : "s"} unrated`;
    case undefined:
      return `Blocked at rung ${at}`;
  }
}

/**
 * Why a climber is blocked and what moves it again, as one sentence — the line under
 * the climber's header. Every reason names its fix, because a blocked climber is the
 * one state on the board nothing will clear by itself.
 */
export function describeClimberBlock(block: ClimberBlock): string {
  switch (block.kind) {
    case "unlaunchable":
      return `This combination cannot be launched: ${block.reason}. Fix the combination, then retry this climber.`;
    case "failing":
      return (
        `The last ${block.attempts} runs on this rung failed on infrastructure, so ` +
        "the ladder stopped launching it. Fix the cause, then retry this climber."
      );
    case "unrated":
      return (
        `${block.runs} completed run${block.runs === 1 ? "" : "s"} on this rung ` +
        `${block.runs === 1 ? "carries" : "carry"} no validator rating, so the gate ` +
        "cannot decide the rung from them. Re-push those runs."
      );
  }
}

/** Whether a climber's block is one Retry can clear. */
export function retryable(climber: LadderClimber): boolean {
  return (
    climber.status === "blocked" &&
    (climber.blocked?.kind === "failing" ||
      climber.blocked?.kind === "unlaunchable")
  );
}

/** The status pill's colour class, one per state (see `Ladder.module.scss`). */
function statusClass(
  climber: LadderClimber,
  dispatch: DispatchStatus,
): string | undefined {
  if (
    dispatch === "stopped" &&
    (climber.status === "running" || climber.status === "blocked")
  ) {
    return ladderStyles.statusStopped;
  }
  switch (climber.status) {
    case "running":
      return ladderStyles.statusRunning;
    case "blocked":
      return ladderStyles.statusBlocked;
    case "failed":
      return ladderStyles.statusFailed;
    case "completed":
      return ladderStyles.statusCompleted;
  }
}

/**
 * The gate evidence behind a rung slot, as one line: how many runs passed against how
 * many counted and how many the gate needs, then the runs the gate cannot read, the
 * runs in flight, and the runs still to launch.
 */
export function describeTally(tally: RungTally): string {
  const parts = [
    `${tally.passing} of ${tally.counted} run${tally.counted === 1 ? "" : "s"} passed (${tally.required} needed)`,
  ];
  if (tally.unrated > 0) {
    parts.push(`${tally.unrated} without a validator rating`);
  }
  if (tally.inFlight > 0) {
    parts.push(`${tally.inFlight} in flight`);
  }
  const toLaunch = tally.pending - tally.inFlight;
  if (toLaunch > 0) {
    parts.push(`${toLaunch} still to launch`);
  }
  return parts.join(" · ");
}

/**
 * What a Stop cancelled. As on a plan's halt, the count is the point: "the queue was
 * already empty" and "nothing this dispatch launched was found" call for opposite next
 * moves and are otherwise indistinguishable.
 */
export function describeLadderStop(result: HaltResult): string {
  const scope = result.includedActive
    ? "including runs already executing"
    : "that had not started";
  if (result.canceled === 0) {
    return `Stopped. No runs of this dispatch were waiting to cancel (${scope}).`;
  }
  const jobs = `${result.canceled} run${result.canceled === 1 ? "" : "s"}`;
  return `Stopped. Canceled ${jobs} ${scope}.`;
}

/** The fix each kind of block asks for, as the status note groups them. */
const BLOCK_NOTES: Record<ClimberBlock["kind"], (n: number) => string> = {
  unlaunchable: (n) =>
    `${n} blocked climber${n === 1 ? "" : "s"} cannot be launched at all: fix the combination named on ${n === 1 ? "its card" : "each card"}, then retry.`,
  failing: (n) =>
    `${blockedSubject(n)} on a rung whose runs keep failing on infrastructure: fix the cause, then retry ${n === 1 ? "it" : "each"}.`,
  unrated: (n) =>
    `${blockedSubject(n)} on a rung whose runs carry no validator rating: re-push those runs.`,
};

/** "1 blocked climber stands", "2 blocked climbers stand": the subject of a block note. */
function blockedSubject(n: number): string {
  return n === 1 ? "1 blocked climber stands" : `${n} blocked climbers stand`;
}

/** The note of a dispatch whose every climber has completed or failed. */
export const LADDER_FINISHED_NOTE = "Finished.";
/** The note of a dispatch its owner stopped. */
export const LADDER_STOPPED_NOTE = "Stopped.";

/** The order the block reasons are listed in. */
const BLOCK_ORDER: ClimberBlock["kind"][] = [
  "unlaunchable",
  "failing",
  "unrated",
];

/**
 * What the summary figures cannot say, in short factual sentences, or null when there
 * is nothing to add.
 *
 * A finished dispatch says "Finished." and a stopped one "Stopped.": the figures say
 * how it went. A running one names the blocked climbers' reasons, each with its count
 * and its fix (the blocked total is already a summary figure), and a dispatch that
 * cannot climb at all because its runs-in-flight limit is zero. A dispatch that is
 * simply running, and a ladder never run, get no note.
 */
export function ladderStatusNote(progress: LadderProgress): string | null {
  const dispatch = progress.dispatch;
  if (!dispatch) return null;
  if (dispatch.status === "finished") return LADDER_FINISHED_NOTE;
  if (dispatch.status === "stopped") return LADDER_STOPPED_NOTE;

  const parts: string[] = [];
  const counts = new Map<ClimberBlock["kind"], number>();
  for (const climber of progress.climbers) {
    const kind =
      climber.status === "blocked" && climber.blocked
        ? climber.blocked.kind
        : null;
    if (kind) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  for (const kind of BLOCK_ORDER) {
    const n = counts.get(kind);
    if (n) parts.push(BLOCK_NOTES[kind](n));
  }
  const limit = dispatch.inFlightLimit;
  if (
    limit.kind === "bounded" &&
    limit.runs === 0 &&
    dispatch.climbersRunning > 0
  ) {
    parts.push(
      "The runs-in-flight limit is 0, so this dispatch launches nothing. Stop it, raise the limit in the editor, and run the ladder again.",
    );
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * The combination a retry call names, rebuilt from a climber.
 *
 * A gg climber carries its configuration and the models bound to that configuration's
 * launch slots through unchanged, because those are what its key is built from: send
 * only the harness and the model and the call would address whichever gg climber
 * happened to share the root model, or none at all.
 */
export function climberCombo(climber: LadderClimber): ReviewPlanCombo {
  return {
    harness: climber.harness,
    model: climber.model,
    ...(climber.provider ? { provider: climber.provider } : {}),
    ...(climber.ggConfigId ? { ggConfigId: climber.ggConfigId } : {}),
    ...(climber.ggConfigName ? { ggConfigName: climber.ggConfigName } : {}),
    ...(climber.ggSlotModels ? { ggSlotModels: climber.ggSlotModels } : {}),
  };
}

/** The badge's colour class: filled for a verdict, muted for anything undecided. */
function slotBadgeClass(status: SlotStatus): string | undefined {
  switch (status) {
    case "passed":
      return ladderStyles.verdictPassed;
    case "failed":
      return ladderStyles.verdictFailed;
    default:
      return ladderStyles.verdictUndecided;
  }
}

/** The rung-track segment's class for one slot. */
function trackStepClass(slot: LadderSlot | undefined): string {
  switch (slot?.status) {
    case "passed":
      return ladderStyles.rungStepDone ?? "";
    case "failed":
      return ladderStyles.rungStepFailed ?? "";
    case "running":
      return ladderStyles.rungStepCurrent ?? "";
    case "blocked":
      return ladderStyles.rungStepBlocked ?? "";
    case "skipped":
      return ladderStyles.rungStepSkipped ?? "";
    default:
      return "";
  }
}

// One rung inside an expanded climber: its slot status, the evidence behind it, and
// the dispatch's runs that are that evidence. A rung the climber has not reached yet
// is still listed, because the rungs *ahead* are what the climb is for, and hiding
// them would make a failed climber look like a completed one.
//
// Every row has the same box: the current rung of a running climber is marked by a
// background alone, so marking it, or the mark moving on as the climber advances,
// never moves anything.
function RungRow({
  rung,
  slot,
  climber,
  current,
}: {
  rung: LadderProgressRung;
  slot: LadderSlot | undefined;
  climber: LadderClimber;
  current: boolean;
}) {
  const testCaseName = useTestCaseName();
  // The runs are fetched only once asked for: a long climb holds a rung per case, and
  // a board that queried every one of them on expand would spend a request per rung to
  // fill a list nobody had looked at.
  const [runsOpen, setRunsOpen] = useState(false);
  const status: SlotStatus = slot?.status ?? "pending";
  const hasRuns = Boolean(
    slot && (slot.runIds.length > 0 || slot.jobIds.length > 0),
  );

  return (
    <li
      className={`${ladderStyles.rungRow} ${current ? ladderStyles.rungRowCurrent : ""}`}
    >
      <span className={ladderStyles.rungIndex}>{rung.position + 1}</span>
      {/* Through the shared pin label, so a rung reads the way the plan's cells and
          the ladder editor's rung list do. Two rungs of one case on two engines are
          two rows, and this is what tells them apart. */}
      <span className={ladderStyles.rungName}>
        {caseLabel(testCaseName(rung.slug), rung)}
      </span>

      <span
        className={`${ladderStyles.verdict} ${slotBadgeClass(status) ?? ""}`}
      >
        {SLOT_BADGE_LABEL[status]}
      </span>

      {slot?.tally && status !== "pending" && status !== "skipped" && (
        <span className={ladderStyles.tally}>{describeTally(slot.tally)}</span>
      )}

      <span className={ladderStyles.rungActions}>
        {/* The runs open **here**, under the rung they belong to, rather than
            handing the reader off to a filtered Runs page: the question a rung
            raises ("why did this fail?") is answered by its own runs. */}
        {hasRuns && (
          <button
            type="button"
            className={ladderStyles.rungLink}
            aria-expanded={runsOpen}
            onClick={() => setRunsOpen((v) => !v)}
          >
            {runsOpen ? "▾" : "▸"} Runs
          </button>
        )}
      </span>

      {runsOpen && slot && (
        <RungRuns rung={rung} climber={climber} slot={slot} />
      )}
    </li>
  );
}

// One climber's card on the board. Its header is a grid of fixed slots: the identity,
// and under it a line of the status, the rung track, and the rung count. The status
// slot has one width whatever it says, from "Running rung 1" to "Blocked at rung 12:
// 3 runs unrated", so a status changing during a climb never moves the track or the
// count. Retry sits on the reason line, beside the fault it answers, so its appearing
// moves nothing in the header either (the reason line itself is the one thing a
// status change adds to a card; see `.climberBlocked`). Starts collapsed: the header
// answers the dashboard's question, and the per-rung evidence is what you open to
// look closer.
export function ClimberRow({
  climber,
  rungs,
  busy,
  dispatch = "running",
  onRetry,
}: {
  climber: LadderClimber;
  rungs: LadderProgressRung[];
  busy: boolean;
  /** Where the dispatch stands: a stopped one reads its climbers as stopped. */
  dispatch?: DispatchStatus;
  /** Retry a climber blocked as failing or unlaunchable. */
  onRetry?: (climber: LadderClimber) => void;
}) {
  const [open, setOpen] = useState(false);
  const passed = climber.slots.filter((s) => s.status === "passed").length;
  const status = climberStatusLabel(climber, rungs.length, dispatch);
  const slotOf = (rung: LadderProgressRung) =>
    climber.slots.find((s) => s.rungId === rung.id);
  // Why the climber is not moving and what fixes it — only while the dispatch can
  // still move it. A combination that cannot launch is named too when the block is
  // something else, because it will stop the climb the moment that clears.
  const live = dispatch === "running";
  const block = live && climber.status === "blocked" ? climber.blocked : null;
  const reasons: string[] = [];
  if (block) reasons.push(describeClimberBlock(block));
  if (live && climber.unlaunchable && block?.kind !== "unlaunchable") {
    reasons.push(
      describeClimberBlock({
        kind: "unlaunchable",
        reason: climber.unlaunchable,
      }),
    );
  }
  const cannotLaunch =
    live && Boolean(climber.unlaunchable) && climber.status !== "blocked";
  const canRetry = live && retryable(climber);

  return (
    <section className={ladderStyles.climber}>
      <div className={ladderStyles.climberHead}>
        <button
          type="button"
          className={ladderStyles.climberToggle}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className={styles.twisty} aria-hidden>
            {open ? "▾" : "▸"}
          </span>
          <span className={ladderStyles.climberIdentity}>
            <span className={ladderStyles.climberTitle}>
              {comboLabel(climber)}
            </span>
            {climber.provider && (
              <span className={ladderStyles.climberMeta}>
                {climber.provider}
              </span>
            )}
            {cannotLaunch && (
              <span
                className={`${ladderStyles.statusPill} ${ladderStyles.statusBlocked}`}
                title={climber.unlaunchable}
              >
                Cannot launch
              </span>
            )}
          </span>
        </button>

        {/* Where the climber stands. A pointer shortcut for the toggle above, which is
            what a keyboard reaches; the track is drawn, not read, so it is hidden from
            assistive technology and its count is said in words beside it. */}
        <div
          className={ladderStyles.climberLine}
          onClick={() => setOpen((v) => !v)}
        >
          <span className={ladderStyles.climberStatusSlot}>
            <span
              className={`${ladderStyles.statusPill} ${statusClass(climber, dispatch) ?? ""}`}
              title={reasons[0] ? `${status}. ${reasons[0]}` : status}
            >
              {status}
            </span>
          </span>
          <span
            className={ladderStyles.rungTrack}
            aria-hidden
            title={`${passed} of ${rungs.length} rungs passed`}
          >
            {rungs.map((rung) => (
              <span
                key={rung.id}
                className={`${ladderStyles.rungStep} ${trackStepClass(slotOf(rung))}`}
              />
            ))}
          </span>
          <span className={ladderStyles.rungCount}>
            {passed}/{rungs.length} rungs
          </span>
        </div>
      </div>

      {/* The reason gets a line of its own under the header, as a blocked cell's does
          on the plan matrix: it is a sentence naming the fault and its fix, and
          nobody can act on it truncated into the header. Shown collapsed too. */}
      {reasons.map((reason, index) => (
        <p key={reason} className={ladderStyles.climberBlocked}>
          {reason}
          {index === 0 && canRetry && onRetry && (
            <>
              {" "}
              <button
                type="button"
                className={`${exec.secondary} ${ladderStyles.retryButton}`}
                disabled={busy}
                aria-label={`Retry ${comboLabel(climber)}`}
                title="Forget the failures so far and launch this climber's rung again. Use once the cause is fixed."
                onClick={() => onRetry(climber)}
              >
                Retry
              </button>
            </>
          )}
        </p>
      ))}

      {open && (
        <ol className={ladderStyles.rungList}>
          {rungs.map((rung) => {
            const slot = slotOf(rung);
            return (
              <RungRow
                key={rung.id}
                rung={rung}
                slot={slot}
                climber={climber}
                current={live && slot?.status === "running"}
              />
            );
          })}
        </ol>
      )}
    </section>
  );
}

// The configured rungs of a ladder never run, so the page says what a Run would climb.
function ConfiguredRungs({ rungs }: { rungs: LadderRung[] }) {
  const testCaseName = useTestCaseName();
  return (
    <ol className={ladderStyles.rungList}>
      {rungs.map((rung, index) => (
        <li key={rung.id} className={ladderStyles.rungRow}>
          <span className={ladderStyles.rungIndex}>{index + 1}</span>
          <span className={ladderStyles.rungName}>
            {caseLabel(testCaseName(rung.slug), rung)}
          </span>
        </li>
      ))}
    </ol>
  );
}

// The per-ladder climb dashboard (`/account/ladders/:ladderId`): the latest dispatch's
// standing, one card per climber, over the controls that run and stop the ladder, and
// the runs left to label. Console-only; gated on a signed-in account, because a ladder
// belongs to one.
//
// Opening this page is a read and only a read. A dispatch launches its own runs, in
// the backend: when Run is pressed, when a climber is retried, and whenever one of its
// runs finishes. None of them is a review: the validators rate every completed run,
// and that rating is all the gate reads.
export function LadderPage() {
  const { ladderId = "" } = useParams();
  const { token } = useAuth();
  const { client: backend } = useBackend();
  const { confirm } = useConfirm();

  // Record this dashboard as the coverage section's index, so a run opened from a rung
  // or from the review queue can return here (see `backReturn`).
  useRecordSectionIndex("coverage");

  // This board lists runs — an expanded rung shows its own, in flight ones included —
  // so it needs the console stream's run-lifecycle topic for exactly as long as it is
  // open. Without it a rung's runs would be a snapshot taken when it was expanded.
  useLiveRunUpdates();
  const { refreshToken, inProgress } = useRunsRuntime();

  const [ladder, setLadder] = useState<Ladder | null>(null);
  const [progress, setProgress] = useState<LadderProgress | null>(null);
  const [queue, setQueue] = useState<CoverageQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The last thing a control did (ran, stopped, retried), reported verbatim: these
  // actions are only trustworthy if they say what they changed.
  const [note, setNote] = useState<string | null>(null);

  // Re-read everything the controls can move: the board and the runs left to label.
  const refresh = useCallback(async () => {
    if (!backend || !token) return;
    const [board, q] = await Promise.all([
      backend.getLadderProgress?.(ladderId, token) ?? Promise.resolve(null),
      backend.getLadderQueue?.(ladderId, token) ?? Promise.resolve(null),
    ]);
    setProgress(board);
    setQueue(q);
  }, [backend, token, ladderId]);

  useEffect(() => {
    if (!backend || !token) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([
      backend.getLadder?.(ladderId, token) ?? Promise.resolve(null),
      backend.getLadderProgress?.(ladderId, token) ?? Promise.resolve(null),
      backend.getLadderQueue?.(ladderId, token) ?? Promise.resolve(null),
    ])
      .then(([entry, board, q]) => {
        if (!active) return;
        setLadder(entry);
        setProgress(board);
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
  }, [backend, token, ladderId]);

  // A run of this dispatch finishing is the event that moves the board without anyone
  // touching it: the tally gains a rated run, and a rung whose gate that settles
  // changes status. The runs runtime bumps `refreshToken` on the stream's `finished`
  // events, so re-read the board on it — skipping the mount, which the load above has
  // just done.
  const seenRefresh = useRef(refreshToken);
  useEffect(() => {
    if (seenRefresh.current === refreshToken) return;
    seenRefresh.current = refreshToken;
    void refresh().catch(() => {});
  }, [refreshToken, refresh]);

  // The backend then launches what the climb needs next, a moment *after* the run
  // finished, and the runs it launches arrive on the same stream as newly queued runs.
  // The finished event's re-read can land before anything has been launched, so the
  // board also re-reads whenever the set of runs in flight changes. Debounced, because
  // a launch enqueues a whole rung's runs at once and one re-read covers them all.
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

  const dispatch = progress?.dispatch ?? null;
  const running = dispatch?.status === "running";

  // Start a dispatch of the configuration as it stands now. Run again replaces the
  // last dispatch's standing on this page (its runs stay in the run list), so that is
  // confirmed; a ladder never run starts at once.
  const run = useCallback(async () => {
    if (!backend?.runLadder || !token) return;
    if (
      dispatch &&
      !(await confirm({
        title: "Run the ladder again",
        message:
          "Start a new dispatch of this ladder as it is configured now? Every climber " +
          "starts again at rung 1, and this page shows the new dispatch instead of the " +
          "last one. The last dispatch's runs stay in the run list.",
        confirmLabel: "Run ladder",
      }))
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const board = await backend.runLadder(ladderId, token);
      setProgress(board);
      setNote(
        "Running: rung 1 is launching for every climber, up to the runs-in-flight limit. " +
          "Each climber climbs on its own as its runs finish.",
      );
      const q = await backend.getLadderQueue?.(ladderId, token);
      if (q) setQueue(q);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [backend, token, ladderId, dispatch, confirm]);

  // End the running dispatch and cancel its runs that have not started. With
  // `cancelRunning` the sweep reaches runs already executing, which are partly or
  // wholly paid for — so it is confirmed, and never the control reached by accident.
  const stop = useCallback(
    async (cancelRunning: boolean) => {
      if (!backend?.stopLadder || !token) return;
      if (
        cancelRunning &&
        !(await confirm({
          title: "Stop and cancel running",
          message:
            "Stop this dispatch and cancel every run it launched, runs already executing " +
            "included? Their work so far is lost and their cost is already spent. Use " +
            "“Stop” to cancel only what has not started.",
          confirmLabel: "Stop and cancel running",
        }))
      ) {
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const result = await backend.stopLadder(
          ladderId,
          { cancelRunning },
          token,
        );
        setNote(describeLadderStop(result));
        await refresh();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [backend, token, ladderId, refresh, confirm],
  );

  // Retry a climber blocked on runs that kept failing or on a combination that could
  // not launch, once its owner has fixed the cause: the backend forgets those failures
  // and relaunches that climber's rung.
  const retry = useCallback(
    async (climber: LadderClimber) => {
      if (!backend?.retryLadderClimber || !token) return;
      setBusy(true);
      setError(null);
      try {
        await backend.retryLadderClimber(
          ladderId,
          { combination: climberCombo(climber) },
          token,
        );
        setNote(`Retrying ${comboLabel(climber)}.`);
        await refresh();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [backend, token, ladderId, refresh],
  );

  if (!token) {
    return (
      <PageLayout>
        <header className={styles.detailHeader}>
          <div className={styles.detailTitleRow}>
            <BackChevron to={routes.accountLadders()} label="All ladders" />
            <h1 className={styles.detailTitle}>Ladder</h1>
          </div>
        </header>
        <p className={`${exec.notice} ${exec.warn}`}>
          Sign in to view a ladder. Ladders are saved to your account, so there
          is nothing to show without one.
        </p>
      </PageLayout>
    );
  }

  const statusNote = progress ? ladderStatusNote(progress) : null;
  const editTo = routes.accountLadderEdit(ladderId);
  const configuredRungs = ladder?.rungs ?? [];
  const noRungs = !dispatch && configuredRungs.length === 0;
  const badge = dispatchStatusLabel(dispatch?.status ?? null);
  const axis = dispatch?.outerAxis ?? ladder?.outerAxis ?? "rung";

  return (
    <PageLayout>
      <header className={styles.detailHeader}>
        <div className={styles.detailTitleRow}>
          <BackChevron to={routes.accountLadders()} label="All ladders" />
          <h1 className={styles.detailTitle}>{ladder?.name ?? ladderId}</h1>
          {!loading && progress && (
            <span
              className={`${ladderStyles.cardBadge} ${ladderStyles.detailBadge} ${
                running
                  ? ladderStyles.badgeRunning
                  : dispatch?.status === "finished"
                    ? ladderStyles.badgeFinished
                    : dispatch?.status === "stopped"
                      ? ladderStyles.badgeStopped
                      : ladderStyles.badgeIdle
              }`}
            >
              {badge}
            </span>
          )}
        </div>
        <Link className={exec.secondary} to={editTo}>
          Edit ladder
        </Link>
      </header>

      <SubmitNotice message={error} />
      {/* A plain notice: a note that revealed itself would pull a reader who had
        already scrolled down back to the top of the page. */}
      {note && <p className={`${exec.notice} ${exec.ok}`}>{note}</p>}

      {loading ? (
        <LoadingState label="Loading the climb…" />
      ) : !progress ? null : noRungs ? (
        <div className={styles.emptyState}>
          <p className={styles.empty}>
            This ladder has no rungs yet. Edit it to pin the cases you want
            climbed, easiest first. The order is the climb.
          </p>
          <Link className={exec.primary} to={editTo}>
            Edit this ladder
          </Link>
        </div>
      ) : (
        <>
          {/* Always the same figures in the same order, so a count changing never moves
              another. Blocked appears only while a climber is blocked, and last, so its
              appearing moves nothing either. */}
          {dispatch && (
            <div className={styles.summary}>
              <span className={styles.summaryStat}>
                <strong>{progress.climbers.length}</strong> climbers
              </span>
              <span className={styles.summaryStat}>
                <strong>{dispatch.climbersRunning}</strong> running
              </span>
              <span className={styles.summaryStat}>
                <strong>{dispatch.climbersCompleted}</strong> completed
              </span>
              <span
                className={styles.summaryStat}
                title="Climbers that failed a rung. Expand one to see the rung and the evidence behind it."
              >
                <strong>{dispatch.climbersFailed}</strong> failed
              </span>
              <span
                className={styles.summaryStat}
                title="Rung slots that will never run: the climber failed an earlier rung, or the dispatch ended first."
              >
                <strong>{dispatch.slots.skipped}</strong> rungs skipped
              </span>
              <span
                className={styles.summaryStat}
                title={inFlightStatTitle(dispatch.inFlightLimit, "ladder")}
              >
                <strong>
                  {dispatch.runs.inFlight}/
                  {formatInFlightLimit(dispatch.inFlightLimit)}
                </strong>{" "}
                in flight
              </span>
              <span
                className={styles.summaryStat}
                title="Completed runs of this dispatch you have not reviewed. Reviews are optional labels (aesthetic rating, writeup) and never move the climb."
              >
                <strong>{progress.runsUnreviewed}</strong> to review
              </span>
              {dispatch.climbersBlocked > 0 && (
                <span
                  className={styles.summaryStat}
                  title="Climbers on a rung the dispatch cannot move by itself. Each card says why, and what fixes it."
                >
                  <strong>{dispatch.climbersBlocked}</strong> blocked
                </span>
              )}
            </div>
          )}

          <div className={styles.controls}>
            <span className={styles.controlOrder}>
              Climbs in this order: <strong>{ladderAxisLabel(axis)}</strong>
            </span>
            <span className={`${styles.controlActions} ${styles.controlEnd}`}>
              <button
                type="button"
                className={exec.primary}
                disabled={busy || running || !backend?.runLadder}
                title={
                  running
                    ? "A dispatch is running. Stop it to run again."
                    : "Start a dispatch of this ladder as it is configured now: every climber starts on rung 1 and climbs on its own as its runs finish."
                }
                onClick={() => void run()}
              >
                ▶ Run ladder
              </button>
              <button
                type="button"
                className={exec.secondary}
                disabled={busy || !running || !backend?.stopLadder}
                title="End this dispatch and cancel its runs that have not started yet."
                onClick={() => void stop(false)}
              >
                Stop
              </button>
              <button
                type="button"
                className={exec.danger}
                disabled={busy || !running || !backend?.stopLadder}
                title="End this dispatch and cancel every run it launched, runs already executing included."
                onClick={() => void stop(true)}
              >
                Stop and cancel running
              </button>
            </span>
          </div>

          {statusNote && (
            // "Finished." and "Stopped." are ends of a dispatch, not faults: plain
            // notices. Everything else the note says needs the owner.
            <p
              className={
                statusNote === LADDER_FINISHED_NOTE ||
                statusNote === LADDER_STOPPED_NOTE
                  ? exec.notice
                  : `${exec.notice} ${exec.warn}`
              }
            >
              {statusNote}
            </p>
          )}

          {!dispatch ? (
            <div className={ladderStyles.notRun}>
              <p className={styles.empty}>
                Not run yet. Press Run ladder to start a dispatch of this
                configuration: every climber starts on rung 1, and each climbs
                to the next rung on its own once the validators pass enough of
                its runs. Edits to the ladder apply to the next Run.
              </p>
              <ConfiguredRungs rungs={configuredRungs} />
            </div>
          ) : (
            <>
              {queue && (
                <CoverageReviewQueue
                  queue={queue}
                  returnLabel="Back to the ladder"
                  title="Label runs (optional)"
                  intro="Completed runs of this dispatch you have not reviewed, in the order it climbs them. A review adds an aesthetic rating and a writeup after the fact; it never moves the climb."
                />
              )}

              <div className={ladderStyles.climbers}>
                {progress.climbers.map((climber) => (
                  <ClimberRow
                    key={climber.key}
                    climber={climber}
                    rungs={progress.rungs}
                    busy={busy}
                    dispatch={dispatch.status}
                    {...(backend?.retryLadderClimber
                      ? { onRetry: (c: LadderClimber) => void retry(c) }
                      : {})}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </PageLayout>
  );
}
