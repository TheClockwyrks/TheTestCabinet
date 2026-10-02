import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import type {
  CoverageQueue,
  HaltResult,
  ReviewPlanCombo,
} from "@clockwyrks/run-record/coverage";
import type {
  ClimberBlock,
  LadderClimber,
  LadderOut,
  LadderProgress,
  LadderProgressRung,
  LadderRungOutcome,
  RungTally,
} from "@clockwyrks/run-record/ladders";
import { useAuth } from "../../../client/auth";
import { useBackend } from "../../../client/context";
import { LoadingState } from "../../components/LoadingState";
import { Switch } from "../../components/Switch";
import { PageLayout } from "../../components/PageLayout";
import { BackChevron } from "../../components/BackChevron";
import { useConfirm } from "../../components/ConfirmDialog";
import { useRecordSectionIndex } from "../../components/backReturn";
import { useTestCaseName } from "../../data/useTestCaseName";
import { useRunsRuntime } from "../../runtime/runsRuntime";
import { useLiveRunUpdates } from "../../runtime/useLiveRunUpdates";
import { routes } from "../../routes";
import { CoverageReviewQueue } from "./CoverageReviewQueue";
import { formatBufferTarget, inFlightStatTitle } from "./bufferTarget";
import { comboLabel } from "./comboLabels";
import { caseLabel } from "./caseLabels";
import { RungRuns } from "./LadderRungRuns";
import { ladderAxisLabel, rungInput } from "./ladderPickers";
import { SubmitNotice } from "../../components/SubmitNotice";
import exec from "../runs/RunExec.module.scss";
import styles from "./Coverage.module.scss";
import ladderStyles from "./Ladder.module.scss";

// The ladder dashboard is the point of the whole feature: one row per climber, each
// saying how far that model got and where it stands now. The status pill, the rung
// track, and the counts are readable at a glance; the per-rung evidence is what an
// expanded row adds.
//
// It shares the coverage pages' visual language (`Coverage.module.scss`) and their
// review queue outright, because a ladder is a sibling of a coverage plan rather than
// a different product. What differs is who moves it: a ladder is an automated climb.
// The validators rate every completed run, the gate reads those ratings, and the
// backend launches each climber's next rung itself as runs finish. A climber failing
// a rung is the ladder's result for that model, not something to work around, so
// nothing on this board changes a verdict, and the review queue is there only for
// labelling runs after the fact.

/**
 * What a rung's badge says for one climber: the verdict when there is one, else what
 * the climber is doing on it (running, blocked, or paused on its current rung), else
 * that the climber has not got there.
 */
export type RungBadge =
  | "passed"
  | "failed"
  | "running"
  | "blocked"
  | "paused"
  | "notReached";

/** The badge text for each {@link RungBadge}. */
export const RUNG_BADGE_LABEL: Record<RungBadge, string> = {
  passed: "Passed",
  failed: "Failed",
  running: "Running",
  blocked: "Blocked",
  paused: "Paused",
  notReached: "Not reached",
};

/** One rung as an expanded climber row describes it, for exactly one climber. */
export interface RungView {
  /** The rung itself, with its pin and how that pin has aged. */
  rung: LadderProgressRung;
  /** The verdict at the rung's **current** pin, or null when there is none yet. */
  outcome: LadderRungOutcome | null;
  /** Verdicts earned against versions the rung no longer pins — history, never
   *  governing. */
  history: LadderRungOutcome[];
  /** Whether this is the rung a **running** climber is working now — the one row the
   *  board highlights. A finished, blocked, or paused climber has no such row. */
  current: boolean;
  /** What the rung's badge says. */
  badge: RungBadge;
  /** The gate evidence, present only for the rung the climber stands on. */
  tally: RungTally | null;
  /** Whether the climber has got this far at all. */
  reached: boolean;
}

/**
 * Line one climber's verdicts up against the ladder's rungs.
 *
 * The wire delivers a climber's verdicts as a flat list in climb order with the
 * superseded ones flagged and trailing, which is the right shape to store and the
 * wrong shape to read: the reader's question is per-rung ("what happened on this
 * case, and against which version"). Pairing them here keeps a rung's current verdict
 * and the history behind it in one place, so no part of the page has to re-derive
 * which of two verdicts for the same rung is the one that counts.
 */
export function buildRungViews(
  climber: LadderClimber,
  rungs: LadderProgressRung[],
): RungView[] {
  const cleared = climber.currentRung?.position ?? rungs.length;
  return rungs.map((rung, index) => {
    const outcome =
      climber.outcomes.find((o) => o.rungId === rung.id && !o.stale) ?? null;
    const standsHere = climber.currentRung?.rungId === rung.id;
    return {
      rung,
      outcome,
      history: climber.outcomes.filter((o) => o.rungId === rung.id && o.stale),
      current: standsHere && climber.status === "running",
      badge: rungBadge(climber, outcome, standsHere, index < cleared),
      tally: standsHere ? climber.currentRung!.tally : null,
      reached: outcome !== null || index <= cleared,
    };
  });
}

function rungBadge(
  climber: LadderClimber,
  outcome: LadderRungOutcome | null,
  standsHere: boolean,
  cleared: boolean,
): RungBadge {
  if (outcome) return outcome.outcome;
  if (standsHere) {
    switch (climber.status) {
      case "running":
      case "blocked":
      case "paused":
        return climber.status;
      case "failed":
        return "failed";
      case "completed":
        return "passed";
    }
  }
  return cleared ? "passed" : "notReached";
}

/**
 * Where a climber stands, in one phrase. Every state but a completed climb names its
 * rung, counted from one for the reader (the wire counts positions from zero),
 * because "failed" alone is the same sentence for a model that fell at the first case
 * and one that passed six.
 */
export function climberStatusLabel(
  climber: LadderClimber,
  rungCount: number,
): string {
  const at = climber.currentRung ? climber.currentRung.position + 1 : rungCount;
  switch (climber.status) {
    case "running":
      return `Running rung ${at}`;
    case "blocked":
      return blockedLabel(climber.blocked, at);
    case "failed":
      return `Failed at rung ${at}`;
    case "paused":
      return climber.currentRung ? `Paused at rung ${at}` : "Paused";
    case "completed":
      return "Completed";
  }
}

/**
 * The status pill of a blocked climber: where it is stuck, and the kind of fault in a
 * few words. The full reason and its fix are on the line under the row's header.
 */
function blockedLabel(block: ClimberBlock | undefined, at: number): string {
  switch (block?.kind) {
    case "unsupportedRung":
      return `Blocked at rung ${at}: not validator-rated`;
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
 *
 * `rungs` and `caseName` name the rung an `unsupportedRung` block points at, so the
 * reader is told *which* rung to replace rather than to go and find it.
 */
export function describeClimberBlock(
  block: ClimberBlock,
  rungs: LadderProgressRung[],
  caseName: (slug: string) => string,
): string {
  switch (block.kind) {
    case "unsupportedRung": {
      const rung = rungs.find((r) => r.id === block.rungId);
      const named = rung
        ? `Rung ${rung.position + 1} (${caseLabel(caseName(rung.slug), rung)})`
        : "This rung";
      return (
        `${named} is not validator-rated: its runs are rated only by a reviewer, and ` +
        "this ladder's gate reads validator ratings, so it can never decide the rung. " +
        "Replace it with a validator-rated version of the case, or remove it, and the climb resumes."
      );
    }
    case "unlaunchable":
      return `This combination cannot be launched: ${block.reason}. Fix the combination or drop it from the ladder, and the climb resumes.`;
    case "failing":
      return (
        `The last ${block.attempts} runs on this rung failed, so the ladder stopped ` +
        "launching it. Fix the cause, then retry this climber."
      );
    case "unrated":
      return (
        `${block.runs} completed run${block.runs === 1 ? "" : "s"} on this rung ` +
        `${block.runs === 1 ? "carries" : "carry"} no validator rating, so the gate ` +
        "cannot decide the rung from them. Re-push those runs, or replace the rung."
      );
  }
}

/** The status pill's colour class, one per state (see `Ladder.module.scss`). */
function statusClass(climber: LadderClimber): string {
  switch (climber.status) {
    case "running":
      return ladderStyles.statusRunning!;
    case "blocked":
      return ladderStyles.statusBlocked!;
    case "failed":
      return ladderStyles.statusFailed!;
    case "paused":
      return ladderStyles.statusPaused!;
    case "completed":
      return ladderStyles.statusCompleted!;
  }
}

/**
 * The gate evidence behind a rung, as one line: how many runs passed against how many
 * finished and how many the gate needs, then the runs the gate cannot read yet and
 * the runs still to come.
 */
export function describeTally(tally: RungTally): string {
  const parts = [
    `${tally.passing} of ${tally.completed} run${tally.completed === 1 ? "" : "s"} passed (${tally.required} needed)`,
  ];
  if (tally.unrated > 0) {
    parts.push(`${tally.unrated} without a validator rating`);
  }
  if (tally.pending > 0) {
    parts.push(`${tally.pending} still to run`);
  }
  return parts.join(" · ");
}

/**
 * What a halt cancelled. As on a plan, the count is the point: "the queue was already
 * empty" and "nothing this ladder launched was found" call for opposite next moves and
 * are otherwise indistinguishable, so a halt that merely succeeded quietly is a halt
 * the reviewer cannot act on.
 */
export function describeLadderHalt(result: HaltResult): string {
  const scope = result.includedActive
    ? "including runs already executing"
    : "that had not started";
  if (result.canceled === 0) {
    return `No jobs of this ladder were waiting to cancel (${scope}).`;
  }
  const jobs = `${result.canceled} job${result.canceled === 1 ? "" : "s"}`;
  return `Canceled ${jobs} ${scope}.`;
}

/** The fix each kind of block asks for, as the status note groups them. */
const BLOCK_NOTES: Record<ClimberBlock["kind"], (n: number) => string> = {
  unsupportedRung: (n) =>
    `${blocked(n)} on a rung that is not validator-rated: replace that rung in the ladder editor.`,
  unlaunchable: (n) =>
    `${n} blocked climber${n === 1 ? "" : "s"} cannot be launched at all: fix or drop the combination named on ${n === 1 ? "its row" : "each row"}.`,
  failing: (n) =>
    `${blocked(n)} on a rung whose runs keep failing: fix the cause, then retry ${n === 1 ? "it" : "each"}.`,
  unrated: (n) =>
    `${blocked(n)} on a rung whose runs carry no validator rating: re-push those runs, or replace the rung.`,
};

/** "1 blocked climber stands", "2 blocked climbers stand": the subject of a block note. */
function blocked(n: number): string {
  return n === 1 ? "1 blocked climber stands" : `${n} blocked climbers stand`;
}

/** The note of a ladder whose every climber has completed or failed. */
export const LADDER_FINISHED_NOTE = "Finished.";

/** The order the block reasons are listed in: the ones only an edit fixes first. */
const BLOCK_ORDER: ClimberBlock["kind"][] = [
  "unsupportedRung",
  "unlaunchable",
  "failing",
  "unrated",
];

/**
 * Why a climber is blocked, as the board and its header count it: the `blocked` reason
 * of a climber whose status is `blocked`, and nothing for any other status. A paused,
 * failed, or completed climber whose combination cannot launch keeps that reason on
 * its own row, where the "Cannot launch" pill shows it; it is not blocked, and the note
 * must agree with the header's blocked count.
 */
function blockKind(climber: LadderClimber): ClimberBlock["kind"] | null {
  return climber.status === "blocked" && climber.blocked
    ? climber.blocked.kind
    : null;
}

/**
 * What the summary figures cannot say, in short factual sentences, or null when there
 * is nothing to add.
 *
 * When every climber has completed or failed the note is just "Finished.": the
 * figures already say how it went. Otherwise it names the blocked climbers' reasons,
 * each with its count and its fix (the blocked total is already a summary figure),
 * and a climb that cannot proceed at all because its runs-in-flight limit is zero. A
 * ladder that is simply running gets no note.
 */
export function ladderStatusNote(
  progress: LadderProgress,
  enabled = false,
): string | null {
  const finished =
    progress.climbers.length > 0 &&
    progress.climbers.every(
      (c) => c.status === "completed" || c.status === "failed",
    );
  if (finished) return LADDER_FINISHED_NOTE;

  const parts: string[] = [];
  const counts = new Map<ClimberBlock["kind"], number>();
  for (const climber of progress.climbers) {
    const kind = blockKind(climber);
    if (kind) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  // The blocked total is the summary's figure, so only the reasons are said here.
  for (const kind of BLOCK_ORDER) {
    const n = counts.get(kind);
    if (n) parts.push(BLOCK_NOTES[kind](n));
  }
  const target = progress.bufferTarget;
  if (
    enabled &&
    target.kind === "bounded" &&
    target.runs === 0 &&
    progress.climbersRunning > 0
  ) {
    parts.push(
      "The runs-in-flight limit is 0, so this ladder launches nothing.",
    );
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * The combination a steering or retry call names, rebuilt from a climber.
 *
 * A gg climber carries its configuration and the models bound to that configuration's
 * launch slots through unchanged, because those are what its key is built from: send
 * only the harness and the model and the call would address whichever gg climber
 * happened to share the root model, or none at all.
 *
 * The derived fields a read filled in — the root `model`, the configuration's current
 * `ggConfigName` — are handed back as they arrived. Storage normalizes them away on a
 * gg member, so echoing them changes nothing about which climber is addressed.
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

// One rung inside an expanded climber: its badge, the evidence behind it, and the runs
// that are that evidence. A rung the climber has not reached yet is still listed,
// because the rungs *ahead* are what the climb is for, and hiding them would make a
// failed climber look like a completed one.
//
// Every row has the same box: the current rung of a running climber is marked by a
// background alone, so marking it, or the mark moving on as the climber advances,
// never moves anything.
function RungRow({
  view,
  climber,
  busy,
  editTo,
  onBump,
}: {
  view: RungView;
  climber: LadderClimber;
  busy: boolean;
  /** Where the ladder is edited, for the "Replace rung" fix; absent offers none. */
  editTo?: string;
  onBump: (rung: LadderProgressRung) => void;
}) {
  const testCaseName = useTestCaseName();
  // The runs are fetched only once asked for: a long climb holds a rung per case, and
  // a board that queried every one of them on expand would spend a request per rung to
  // fill a list nobody had looked at.
  const [runsOpen, setRunsOpen] = useState(false);
  const { rung, outcome, history, current, badge, tally, reached } = view;

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
      {/* A rung the ladder cannot climb at all: its version is rated only by a
          reviewer, and the gate reads validator ratings. Said on the rung itself,
          for every climber, because the fix is to the ladder and not to any run. */}
      {!rung.supported && (
        <span
          className={ladderStyles.rungProblem}
          title="This rung's case version is not validator-rated: its runs are rated only by a reviewer, so the gate can never decide it and the ladder never launches it. Replace it with a validator-rated version, or remove it."
        >
          Not validator-rated: cannot be climbed
        </span>
      )}

      <span className={`${ladderStyles.verdict} ${verdictClass(badge)}`}>
        {RUNG_BADGE_LABEL[badge]}
      </span>

      {outcome && !outcome.recorded && (
        <span
          className={ladderStyles.verdictNote}
          title="Computed from the validators' ratings for this view. The next launch pass writes it down; reading a board never writes."
        >
          not written down yet
        </span>
      )}
      {tally && (
        <span className={ladderStyles.tally}>{describeTally(tally)}</span>
      )}
      {history.length > 0 && (
        <span
          className={ladderStyles.verdictNote}
          title="Verdicts earned against a version this rung no longer pins. Kept so a bump does not erase what a model achieved; never allowed to govern the climb."
        >
          history:{" "}
          {history.map((h) => `${h.decidedVersion} ${h.outcome}`).join(", ")}
        </span>
      )}

      <span className={ladderStyles.rungActions}>
        {!rung.supported && editTo && (
          <Link className={ladderStyles.rungLink} to={editTo}>
            Replace rung
          </Link>
        )}
        {rung.stale && (
          <button
            type="button"
            className={styles.staleBadge}
            disabled={busy}
            title={`A newer version (${rung.latestVersion}) is ingested. Bumping re-opens this rung for every climber; verdicts decided against ${rung.version} are kept as history.`}
            onClick={() => onBump(rung)}
          >
            {rung.version} → {rung.latestVersion} ↑
          </button>
        )}
        {/* The runs open **here**, under the rung they belong to, rather than
            handing the reader off to a filtered Runs page: the question a rung
            raises ("why did this fail?") is answered by its own runs. */}
        {reached && (
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

      {runsOpen && <RungRuns rung={rung} climber={climber} />}
    </li>
  );
}

/** The badge's colour class: filled for a verdict, muted for anything undecided. */
function verdictClass(badge: RungBadge): string {
  switch (badge) {
    case "passed":
      return ladderStyles.verdictPassed!;
    case "failed":
      return ladderStyles.verdictFailed!;
    default:
      return ladderStyles.verdictUndecided!;
  }
}

/** The rung-track segment's class for the rung at `index`. */
function trackStepClass(
  climber: LadderClimber,
  index: number,
  cleared: number,
): string {
  if (index < cleared) return ladderStyles.rungStepDone!;
  if (index !== cleared) return "";
  switch (climber.status) {
    case "running":
      return ladderStyles.rungStepCurrent!;
    case "failed":
      return ladderStyles.rungStepFailed!;
    case "blocked":
      return ladderStyles.rungStepBlocked!;
    case "paused":
    case "completed":
      return "";
  }
}

// One climber's card on the board. Its header is a grid of fixed slots: the identity
// beside the controls, and under them a line of the status, the rung track, and the
// rung count. The status slot has one width whatever it says, from "Running rung 1"
// to "Blocked at rung 12: not validator-rated", so a status changing during a climb
// never moves the track, the count, or the controls. At desktop widths every status
// fits its slot; on a narrower card a long one is cut short inside it, with the whole
// status and its reason in the pill's tooltip and the reason on the line below. Retry
// sits on that reason line, beside the fault it answers, so its appearing moves
// nothing in the header either (the reason line itself is the one thing a status
// change adds to a card; see `.climberBlocked`). Starts collapsed: the header answers the
// dashboard's question, and the per-rung evidence is what you open to look closer.
export function ClimberRow({
  climber,
  rungs,
  busy,
  editTo,
  onSteer,
  onRetry,
  onBump,
}: {
  climber: LadderClimber;
  rungs: LadderProgressRung[];
  busy: boolean;
  /** Where the ladder is edited, for the fixes that are an edit to it. */
  editTo?: string;
  onSteer: (climber: LadderClimber, steering: SteeringPatch) => void;
  /** Retry a climber blocked because its rung's runs keep failing. */
  onRetry?: (climber: LadderClimber) => void;
  onBump: (rung: LadderProgressRung) => void;
}) {
  const [open, setOpen] = useState(false);
  const cleared = climber.currentRung?.position ?? rungs.length;
  const views = buildRungViews(climber, rungs);
  const status = climberStatusLabel(climber, rungs.length);
  const testCaseName = useTestCaseName();
  // Why the climber is not moving and what fixes it. Read off the climber, never off
  // its rung: a completed climber has no `currentRung` at all. A blocked climber's
  // reason comes first; a combination that cannot launch is named too when the block
  // is something else (or the climber is in another state), because it will stop the
  // climb the moment that clears.
  const block = climber.blocked ?? null;
  const reasons: string[] = [];
  if (block) reasons.push(describeClimberBlock(block, rungs, testCaseName));
  if (climber.unlaunchable && block?.kind !== "unlaunchable") {
    reasons.push(
      describeClimberBlock(
        { kind: "unlaunchable", reason: climber.unlaunchable },
        rungs,
        testCaseName,
      ),
    );
  }
  // A climber in another state whose combination cannot launch gets a pill of its own
  // in its identity slot; a blocked one already says so in its status pill.
  const cannotLaunch =
    Boolean(climber.unlaunchable) && climber.status !== "blocked";
  const retryable = block?.kind === "failing";

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

        <span className={ladderStyles.climberActions}>
          <button
            type="button"
            className={`${ladderStyles.focusButton} ${
              climber.focused ? ladderStyles.focusOn : ""
            }`}
            aria-pressed={climber.focused}
            // Named by the whole combination, not by the model alone: two gg climbers
            // of different configurations can share a root model, and a screen reader
            // would otherwise be offered two identical controls.
            aria-label={
              climber.focused
                ? `Stop watching ${comboLabel(climber)}`
                : `Watch ${comboLabel(climber)}`
            }
            title="Watch this one. Also the tiebreak between climbers of equal priority."
            disabled={busy}
            onClick={() => onSteer(climber, { focused: !climber.focused })}
          >
            {climber.focused ? "★" : "☆"}
          </button>
          <PriorityField climber={climber} busy={busy} onSteer={onSteer} />
          <button
            type="button"
            // One width for both labels, so pausing never shifts the controls.
            className={`${exec.secondary} ${ladderStyles.pauseButton}`}
            disabled={busy}
            title={
              climber.paused
                ? "Continue this climber from exactly where it stopped."
                : "Stop this climber where it stands. Nothing is decided and nothing is cancelled."
            }
            onClick={() => onSteer(climber, { paused: !climber.paused })}
          >
            {climber.paused ? "Resume" : "Pause"}
          </button>
        </span>

        {/* Where the climber stands. A pointer shortcut for the toggle above, which is
            what a keyboard reaches; the track is drawn, not read, so it is hidden from
            assistive technology and its count is said in words beside it. */}
        <div
          className={ladderStyles.climberLine}
          onClick={() => setOpen((v) => !v)}
        >
          <span className={ladderStyles.climberStatusSlot}>
            <span
              className={`${ladderStyles.statusPill} ${statusClass(climber)}`}
              title={reasons[0] ? `${status}. ${reasons[0]}` : status}
            >
              {status}
            </span>
          </span>
          {/* One segment per rung, so how far the model got is a position on a line
              rather than a number to be read. */}
          <span
            className={ladderStyles.rungTrack}
            aria-hidden
            title={`${cleared} of ${rungs.length} rungs passed`}
          >
            {rungs.map((rung, index) => (
              <span
                key={rung.id}
                className={`${ladderStyles.rungStep} ${trackStepClass(climber, index, cleared)}`}
              />
            ))}
          </span>
          <span className={ladderStyles.rungCount}>
            {cleared}/{rungs.length} rungs
          </span>
        </div>
      </div>

      {/* The reason gets a line of its own under the header, as a blocked cell's does
          on the plan matrix: it is a sentence naming the fault and its fix, and
          nobody can act on it truncated into the header. Shown collapsed too. The fix
          the board can perform sits at the end of its sentence: Retry for runs that
          kept failing, and a link to the editor for a rung that needs replacing. */}
      {reasons.map((reason, index) => (
        <p key={reason} className={ladderStyles.climberBlocked}>
          {reason}
          {index === 0 && block?.kind === "unsupportedRung" && editTo && (
            <>
              {" "}
              <Link to={editTo}>Replace the rung</Link>
            </>
          )}
          {index === 0 && retryable && onRetry && (
            <>
              {" "}
              <button
                type="button"
                className={`${exec.secondary} ${ladderStyles.retryButton}`}
                disabled={busy}
                title="Relaunch this climber's rung. Use once the cause of the failing runs is fixed."
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
          {views.map((view) => (
            <RungRow
              key={view.rung.id}
              view={view}
              climber={climber}
              busy={busy}
              {...(editTo === undefined ? {} : { editTo })}
              onBump={onBump}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * A climber's climb-order weight: edited locally, written once it is settled.
 *
 * Every other steering control is a single gesture with a single value, but this one
 * is typed — and typing "12" passes through "1", which is a different, valid priority.
 * Writing on every keystroke therefore sent a write per digit, each of which re-read
 * the board and re-rendered the field from the server's answer, so a half-typed number
 * was liable to be replaced by an earlier one mid-edit: the field appeared to change
 * itself. The draft is held here until the reviewer is done with it (blur, or Enter)
 * and only then written, and only when it actually differs from what the board says.
 *
 * A null draft means "showing the board's value", so a refresh lands as normal while
 * the field is idle and is ignored while it is being typed into.
 */
function PriorityField({
  climber,
  busy,
  onSteer,
}: {
  climber: LadderClimber;
  busy: boolean;
  onSteer: (climber: LadderClimber, steering: SteeringPatch) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    // An emptied field is an abandoned edit, not a request for priority zero.
    if (draft.trim() === "") return;
    const n = Math.floor(Number(draft));
    if (!Number.isFinite(n)) return;
    const priority = Math.min(Math.max(n, 0), 99);
    if (priority !== climber.priority) onSteer(climber, { priority });
  };

  return (
    <label className={ladderStyles.priorityField}>
      priority
      <input
        className={exec.input}
        type="number"
        min={0}
        max={99}
        step={1}
        aria-label={`Climb priority for ${comboLabel(climber)}`}
        title="Higher climbs first. Pushes one model to the front without reordering the ladder, which would change what every other climber is measured against."
        disabled={busy}
        value={draft ?? String(climber.priority)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            setDraft(null);
          }
        }}
      />
    </label>
  );
}

/** The one field of a climber's steering a control changes; the rest is carried. */
export interface SteeringPatch {
  priority?: number;
  focused?: boolean;
  paused?: boolean;
}

// The per-ladder climb dashboard (`/account/ladders/:ladderId`): one card per climber
// saying where it stands, over the controls that switch the ladder on and off or stop
// it, and the runs left to label. Console-only; gated on a signed-in account, because a
// ladder belongs to one.
//
// Opening this page is a read and only a read. An enabled ladder launches its own
// runs, in the backend: when it is enabled, when it is edited, when a climber is
// retried, and whenever one of its runs finishes. None of them is a review: the
// validators rate every completed run, and that rating is all the gate reads.
export function LadderPage() {
  const { ladderId = "" } = useParams();
  const enabledId = useId();
  const { token } = useAuth();
  const { client: backend } = useBackend();
  const { confirm } = useConfirm();

  // Record this dashboard as the coverage section's index, so a run opened from a rung
  // or from the review queue can return here (see `backReturn`).
  useRecordSectionIndex("coverage");

  // This board lists runs — an expanded rung shows its own, in flight ones included —
  // so it needs the console stream's run-lifecycle topic for exactly as long as it is
  // open, the same way the Runs section declares it. Without it a rung's runs would be
  // a snapshot taken when it was expanded: a queued run would never be seen to start,
  // and a finished one would sit in the list as "running" until someone navigated.
  useLiveRunUpdates();
  const { refreshToken, inProgress } = useRunsRuntime();

  const [ladder, setLadder] = useState<LadderOut | null>(null);
  const [progress, setProgress] = useState<LadderProgress | null>(null);
  const [queue, setQueue] = useState<CoverageQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The last thing a control did (halted, retried, bumped a rung), reported verbatim:
  // these actions are only trustworthy if they say what they changed.
  const [note, setNote] = useState<string | null>(null);

  // Re-read everything the controls can move: the board (statuses, verdicts, counts)
  // and the runs left to label.
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

  // A run of this ladder finishing is the event that moves the board without anyone
  // touching it: the tally gains a rated run, and a rung whose gate that settles
  // changes verdict. The runs runtime bumps `refreshToken` on the stream's `finished`
  // events, so re-read the board on it — skipping the mount, which the load above has
  // just done.
  const seenRefresh = useRef(refreshToken);
  useEffect(() => {
    if (seenRefresh.current === refreshToken) return;
    seenRefresh.current = refreshToken;
    void refresh();
  }, [refreshToken, refresh]);

  // The backend then launches what the climb needs next, a moment *after* the run
  // finished (or after the ladder is enabled, or a climber retried), and the runs it
  // launches arrive on the same stream as newly queued runs. The finished event's
  // re-read can land before anything has been launched, so the board also re-reads
  // whenever the set of runs in flight changes. Debounced, because a launch enqueues a
  // whole rung's runs at once and one re-read covers them all.
  const inFlightKey = inProgress
    .map((r) => r.runId)
    .sort()
    .join("|");
  const seenInFlight = useRef(inFlightKey);
  useEffect(() => {
    if (seenInFlight.current === inFlightKey) return;
    seenInFlight.current = inFlightKey;
    const timer = setTimeout(() => void refresh(), 300);
    return () => clearTimeout(timer);
  }, [inFlightKey, refresh]);

  // Opening the dashboard deliberately launches **nothing**. Reading a board is not a
  // decision to spend, and a page that spent tokens because it was looked at is a page
  // nobody can open to check on a ladder they have deliberately switched off.

  // Enable or disable the ladder: the one switch that decides whether it may launch
  // runs at all. Takes the state rather than toggling, so the control cannot disagree
  // with the server about which way it goes. Enabling starts the climb in the backend,
  // and the runs it launches reach the board through the in-flight watcher above.
  // Disabling stops new launches only: whatever is already queued carries on, and
  // cancelling it is what Halt is for. Neither says anything: the switch is the state.
  const setEnabled = useCallback(
    async (enabled: boolean) => {
      if (!backend?.pauseLadder || !token) return;
      setBusy(true);
      setError(null);
      try {
        const schedule = await backend.pauseLadder(ladderId, !enabled, token);
        setLadder((l) => (l ? { ...l, ...schedule } : l));
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [backend, token, ladderId],
  );

  // Pause and cancel this ladder's jobs. `all` extends the sweep to jobs already
  // executing, which are partly or wholly paid for — so it is confirmed, and never the
  // control the reviewer reaches by accident.
  const halt = useCallback(
    async (all: boolean) => {
      if (!backend || !token) return;
      // Resolved (not called) through the client so the transport keeps its own
      // receiver; a transport that does not implement halting simply has no control.
      const supported = all ? backend.haltAllLadder : backend.haltLadder;
      if (!supported) return;
      if (
        all &&
        !(await confirm({
          title: "Halt everything",
          message:
            "Cancel every job this ladder launched, including runs already executing? " +
            "Their work so far is lost and their cost is already spent. Use “Halt” to " +
            "cancel only what has not started.",
          confirmLabel: "Halt everything",
        }))
      ) {
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const result: HaltResult | undefined = all
          ? await backend.haltAllLadder?.(ladderId, token)
          : await backend.haltLadder?.(ladderId, token);
        if (result) setNote(describeLadderHalt(result));
        // A halt always leaves the ladder disabled, whatever it found to cancel.
        setLadder((l) => (l ? { ...l, paused: true } : l));
        await refresh();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [backend, token, ladderId, refresh, confirm],
  );

  // One combination's steering, written whole: the control changes one field and the
  // other two are carried from the board, because the wire takes the whole decision
  // ("climb this one first and watch it") and a partial write can leave a climber
  // focused but forgotten.
  const steer = useCallback(
    async (climber: LadderClimber, patch: SteeringPatch) => {
      if (!backend?.setLadderClimber || !token) return;
      setBusy(true);
      setError(null);
      try {
        await backend.setLadderClimber(
          ladderId,
          {
            combination: climberCombo(climber),
            priority: patch.priority ?? climber.priority,
            focused: patch.focused ?? climber.focused,
            paused: patch.paused ?? climber.paused,
          },
          token,
        );
        // A pause changes a climber's status and a priority changes the board's
        // order, so the board is re-read rather than patched locally.
        await refresh();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [backend, token, ladderId, refresh],
  );

  // Retry a climber whose rung's runs kept failing, once its owner has fixed the
  // cause: the backend forgets those failures and relaunches that climber's rung.
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

  // Re-pin one rung to the newest ingested version of its case. Saved through the
  // ladder rather than a dedicated call because it is an edit to the climb; rungs
  // reconcile on their stable ids, so every climber's verdicts stay attached — the
  // ones decided against the old version simply stop governing and become history.
  const bumpRung = useCallback(
    async (rung: LadderProgressRung) => {
      if (!backend?.updateLadder || !token || !ladder) return;
      if (
        !(await confirm({
          title: `Bump rung ${rung.position + 1}`,
          message:
            `Bump rung ${rung.position + 1} from ${rung.version} to ${rung.latestVersion}? ` +
            `Every climber re-attempts it at the new version; verdicts decided against ` +
            `${rung.version} are kept as history and stop governing the climb.`,
          confirmLabel: "Bump rung",
        }))
      ) {
        return;
      }
      setBusy(true);
      setError(null);
      try {
        await backend.updateLadder(
          ladder.id,
          {
            name: ladder.name,
            runsPerCell: ladder.runsPerCell,
            gate: ladder.gate,
            comboGroupIds: ladder.comboGroupIds,
            combos: ladder.combos,
            // Every rung rewritten as it stands, through the same projection the
            // editor loads with — the version of the one being bumped is the only
            // thing that changes. Anything else this list forgot (the engine, a run
            // override) would be dropped from the ladder by the save.
            rungs: ladder.rungs.map((r) => ({
              ...rungInput(r),
              version: r.id === rung.id ? rung.latestVersion : r.version,
            })),
            // No schedule: bumping a pin is not a decision to enable a disabled ladder.
          },
          token,
        );
        const entry = await backend.getLadder?.(ladderId, token);
        if (entry) setLadder(entry);
        setNote(
          `Rung ${rung.position + 1} now pins ${rung.latestVersion}. Verdicts on ${rung.version} are kept as history.`,
        );
        await refresh();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [backend, token, ladder, ladderId, refresh, confirm],
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

  const statusNote = progress
    ? ladderStatusNote(progress, ladder?.paused === false)
    : null;
  const editTo = routes.accountLadderEdit(ladderId);

  return (
    <PageLayout>
      <header className={styles.detailHeader}>
        <div className={styles.detailTitleRow}>
          <BackChevron to={routes.accountLadders()} label="All ladders" />
          <h1 className={styles.detailTitle}>{ladder?.name ?? ladderId}</h1>
        </div>
        <Link
          className={exec.secondary}
          to={routes.accountLadderEdit(ladderId)}
        >
          Edit ladder
        </Link>
      </header>

      <SubmitNotice message={error} />
      {/* A plain notice: a note that revealed itself would pull a reader who had
        already scrolled down back to the top of the page. */}
      {note && <p className={`${exec.notice} ${exec.ok}`}>{note}</p>}

      {loading ? (
        <LoadingState label="Loading the climb…" />
      ) : !progress || progress.rungs.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.empty}>
            This ladder has no rungs yet. Edit it to pin the cases you want
            climbed, easiest first. The order is the climb.
          </p>
          <Link
            className={exec.primary}
            to={routes.accountLadderEdit(ladderId)}
          >
            Edit this ladder
          </Link>
        </div>
      ) : (
        <>
          {/* Always the same figures in the same order, so a count changing never moves
              another. Blocked and Paused appear only while a climber is in that
              state, and last, so their appearing moves nothing either. */}
          <div className={styles.summary}>
            <span className={styles.summaryStat}>
              <strong>{progress.climbers.length}</strong> climbers
            </span>
            <span className={styles.summaryStat}>
              <strong>{progress.climbersRunning}</strong> running
            </span>
            <span className={styles.summaryStat}>
              <strong>{progress.climbersCompleted}</strong> completed
            </span>
            <span
              className={styles.summaryStat}
              title="Climbers that failed a rung. Expand one to see the rung and the evidence behind it."
            >
              <strong>{progress.climbersFailed}</strong> failed
            </span>
            <span
              className={styles.summaryStat}
              title={inFlightStatTitle(progress.bufferTarget)}
            >
              <strong>
                {progress.runsInFlight}/
                {formatBufferTarget(progress.bufferTarget)}
              </strong>{" "}
              in flight
            </span>
            <span
              className={styles.summaryStat}
              title="Completed runs you have not reviewed. Reviews are optional labels (aesthetic rating, writeup) and never move the climb."
            >
              <strong>{progress.runsUnreviewed}</strong> to review
            </span>
            {progress.climbersBlocked > 0 && (
              <span
                className={styles.summaryStat}
                title="Climbers on a rung the ladder cannot decide by itself. Each card says why, and what fixes it."
              >
                <strong>{progress.climbersBlocked}</strong> blocked
              </span>
            )}
            {progress.climbersPaused > 0 && (
              <span className={styles.summaryStat}>
                <strong>{progress.climbersPaused}</strong> paused
              </span>
            )}
          </div>

          <div className={styles.controls}>
            <span className={styles.controlOrder}>
              Climbs in this order:{" "}
              <strong>{ladderAxisLabel(progress.outerAxis)}</strong>
            </span>
            <label
              className={`${styles.controlToggle} ${styles.controlEnd}`}
              htmlFor={enabledId}
              title="On: this ladder launches its runs by itself as its climb needs them. Off: nothing more is launched; runs already queued carry on. A new ladder starts off."
            >
              <Switch
                id={enabledId}
                checked={ladder?.paused === false}
                // Gated on the ladder having loaded: the control sends a state, not a
                // toggle, and it cannot know which state to send until it knows the
                // one the ladder is in.
                disabled={busy || !ladder || !backend?.pauseLadder}
                onChange={(on) => void setEnabled(on)}
              />
              Enabled
            </label>
            <span className={styles.controlActions}>
              <button
                type="button"
                className={exec.secondary}
                disabled={busy || !backend?.haltLadder}
                title="Switch this ladder off, and cancel its jobs that have not started yet."
                onClick={() => void halt(false)}
              >
                Halt
              </button>
              <button
                type="button"
                className={exec.danger}
                disabled={busy || !backend?.haltAllLadder}
                title="Switch this ladder off, and cancel every job it launched, runs already executing included."
                onClick={() => void halt(true)}
              >
                Halt all
              </button>
            </span>
          </div>

          {statusNote && (
            // "Finished." is the normal end of a ladder, not a fault: a plain notice.
            // Everything else the note says needs the owner, so it is a warning.
            <p
              className={
                statusNote === LADDER_FINISHED_NOTE
                  ? exec.notice
                  : `${exec.notice} ${exec.warn}`
              }
            >
              {statusNote}
            </p>
          )}

          {queue && (
            <CoverageReviewQueue
              queue={queue}
              returnLabel="Back to the ladder"
              title="Label runs (optional)"
              intro="Completed runs of this ladder you have not reviewed, in the order it climbs them. A review adds an aesthetic rating and a writeup after the fact; it never moves the climb."
            />
          )}

          <div className={ladderStyles.climbers}>
            {progress.climbers.map((climber) => (
              <ClimberRow
                key={climber.key}
                climber={climber}
                rungs={progress.rungs}
                busy={busy}
                editTo={editTo}
                onSteer={(c, patch) => void steer(c, patch)}
                {...(backend?.retryLadderClimber
                  ? { onRetry: (c: LadderClimber) => void retry(c) }
                  : {})}
                onBump={(rung) => void bumpRung(rung)}
              />
            ))}
          </div>
        </>
      )}
    </PageLayout>
  );
}
