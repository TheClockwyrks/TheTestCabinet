import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import type {
  CoverageQueue,
  HaltResult,
  ReviewPlanCombo,
  TopUpResult,
} from "@clockwyrks/run-record/coverage";
import type {
  ClimberBlock,
  LadderClimber,
  LadderOut,
  LadderProgress,
  LadderProgressRung,
  LadderRungOutcome,
  LadderSchedule,
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
import { describeUnlaunchable } from "./coveragePlan";
import {
  bufferIsFull,
  formatBufferTarget,
  inFlightStatTitle,
} from "./bufferTarget";
import { comboLabel } from "./comboLabels";
import { caseLabel } from "./caseLabels";
import { RungRuns } from "./LadderRungRuns";
import { ladderAxisLabel, rungInput } from "./ladderPickers";
import { SubmitNotice } from "../../components/SubmitNotice";
import exec from "../runs/RunExec.module.scss";
import styles from "./Coverage.module.scss";
import ladderStyles from "./Ladder.module.scss";

// The ladder dashboard is the point of the whole feature: one row per climber, each
// saying where that model stopped and why. Everything here exists to answer "where is
// the wall for each of these models" without expanding anything — the status pill, the
// rung track, and the counts are readable at a glance, and the per-rung evidence is
// what an expanded row adds.
//
// It shares the coverage pages' visual language (`Coverage.module.scss`) and their
// review queue outright, because a ladder is a sibling of a coverage plan rather than
// a different product. What differs is who moves it: a ladder is an automated climb.
// The validators rate every completed run, the gate reads those ratings, and the
// backend launches the next rung itself as each run finishes — so nothing on this
// board waits on a review, and the review queue is there only for labelling runs
// after the fact.

/** One rung as an expanded climber row describes it, for exactly one climber. */
export interface RungView {
  /** The rung itself, with its pin and how that pin has aged. */
  rung: LadderProgressRung;
  /** The verdict at the rung's **current** pin, or null when there is none yet. */
  outcome: LadderRungOutcome | null;
  /** Verdicts earned against versions the rung no longer pins — history, never
   *  governing. */
  history: LadderRungOutcome[];
  /** Whether this is the rung the climber stands on right now. */
  current: boolean;
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
 * wrong shape to read: the reviewer's question is per-rung ("what happened on this
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
    return {
      rung,
      outcome,
      history: climber.outcomes.filter((o) => o.rungId === rung.id && o.stale),
      current: climber.currentRung?.rungId === rung.id,
      tally:
        climber.currentRung?.rungId === rung.id
          ? climber.currentRung.tally
          : null,
      reached: outcome !== null || index <= cleared,
    };
  });
}

/**
 * Where a climber stands, in one phrase — or null when nothing needs saying.
 *
 * The rung **number** is part of the answer in every stopped state, because "walled"
 * alone is the same sentence for a model that fell at the first case and one that
 * cleared six — and telling those two apart is the reason to run a ladder at all.
 * Rungs are numbered from one for the reader; the wire counts positions from zero.
 *
 * A climber that is simply climbing gets **no** phrase. It is the unremarkable state,
 * and the row already says it twice over — the track marks the rung being worked, and
 * the count beside it reads "1/6 rungs". A pill that only ever repeated those was
 * three ways of saying the same thing, and it crowded out the row's actual subject.
 */
export function climberStatusLabel(
  climber: LadderClimber,
  rungCount: number,
): string | null {
  const at = climber.currentRung ? climber.currentRung.position + 1 : rungCount;
  switch (climber.status) {
    case "held":
      return climber.currentRung ? `Held at rung ${at}` : "Held";
    case "walled":
      return `Walled at rung ${at}`;
    case "blocked":
      return blockedLabel(climber.blocked, at);
    case "climbing":
      return null;
    case "toppedOut":
      return `Topped out: all ${rungCount} rungs cleared`;
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
        `The last ${block.attempts} runs on this rung failed, so the ladder has stopped ` +
        "relaunching it by itself. Fix the cause, then press “Top up now” to launch it again."
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
    case "held":
      return ladderStyles.statusHeld!;
    case "walled":
      return ladderStyles.statusWalled!;
    case "blocked":
      return ladderStyles.statusBlocked!;
    case "climbing":
      return ladderStyles.statusClimbing!;
    case "toppedOut":
      return ladderStyles.statusTopped!;
  }
}

/**
 * The gate evidence behind a rung, stated as a sentence.
 *
 * Every number here answers a different "why is this not moving": runs still to come
 * are the ladder's to launch, runs with no validator rating are a fault the gate
 * cannot see past, and the required count is what the two knobs of the gate actually
 * add up to on this rung. Someone who disagrees with a wall needs all of them to see
 * where the disagreement is.
 */
export function describeTally(tally: RungTally): string {
  const parts = [
    `${tally.completed} run${tally.completed === 1 ? "" : "s"} in`,
    `${tally.passing} of ${tally.rated} rated clear the bar (${tally.required} needed)`,
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
 * What a top-up actually did, in one sentence, in the ladder's own vocabulary.
 *
 * The plan's version of this exists too and says "cell" where this says "rung"; they
 * are kept apart on purpose, because the *reason* a ladder enqueued nothing is often
 * different in kind — every climber may be walled or held, which is a finished ladder
 * rather than a satisfied one, and telling a reviewer their plan is "at its target"
 * when in truth every model has stopped would be actively misleading. The climbers
 * nothing could launch trail every outcome the scheduler reached, exactly as they do
 * on a plan.
 *
 * On a ladder `outstanding` is the runs in flight alone, so a full cap is never a
 * wait on a person: the climb carries on by itself as those runs finish. Jobs an early
 * stop cancelled are reported on every outcome, because they are the one thing a
 * top-up removes rather than adds.
 */
export function describeLadderTopUp(result: TopUpResult): string {
  if (result.skipped === "paused") {
    return "This ladder is disabled, so nothing was enqueued. Switch it on to let it climb.";
  }
  if (result.skipped === "busy") {
    return "A top-up for this ladder was already running. It runs once more for this request before it finishes, so nothing is enqueued twice.";
  }
  const blocked = describeUnlaunchable(result.unlaunchable);
  const stopped = result.earlyStopCanceled ?? 0;
  const canceled =
    stopped > 0
      ? ` Cancelled ${stopped} job${stopped === 1 ? "" : "s"} that had not started, on rungs the gate had already decided.`
      : "";
  if (result.enqueued > 0) {
    const runs = `${result.enqueued} run${result.enqueued === 1 ? "" : "s"}`;
    const rungs = `${result.cells.length} rung${result.cells.length === 1 ? "" : "s"}`;
    return `Enqueued ${runs} across ${rungs}, in the order this ladder climbs them.${canceled}${blocked}`;
  }
  const inFlight = result.outstanding ?? 0;
  if (bufferIsFull(result.bufferTarget, inFlight)) {
    return (
      `Nothing enqueued: ${inFlight} of ${formatBufferTarget(result.bufferTarget)} runs ` +
      `are already in flight. The ladder climbs on as they finish.${canceled}${blocked}`
    );
  }
  if (blocked) {
    return `Nothing enqueued: every climber is stopped, satisfied, or unlaunchable.${canceled}${blocked}`;
  }
  return (
    "Nothing left to enqueue: every climber is at its rung's target, walled, " +
    `blocked, held, or topped out.${canceled}`
  );
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
    `${n} ${n === 1 ? "stands" : "stand"} on a rung that is not validator-rated: replace that rung in the ladder editor.`,
  unlaunchable: (n) =>
    `${n} cannot be launched at all: fix or drop the combination named on ${n === 1 ? "its row" : "each row"}.`,
  failing: (n) =>
    `${n} ${n === 1 ? "stands" : "stand"} on a rung whose runs keep failing: fix the cause, then press “Top up now”.`,
  unrated: (n) =>
    `${n} ${n === 1 ? "stands" : "stand"} on a rung whose runs carry no validator rating: re-push those runs, or replace the rung.`,
};

/** The order the block reasons are listed in: the ones only an edit fixes first. */
const BLOCK_ORDER: ClimberBlock["kind"][] = [
  "unsupportedRung",
  "unlaunchable",
  "failing",
  "unrated",
];

/**
 * Why a climber is blocked, as the board and its header count it: the `blocked` reason
 * of a climber whose status is `blocked`, and nothing for any other status. A held,
 * walled or topped-out climber whose combination cannot launch keeps that reason on
 * its own row, where the "Cannot launch" pill shows it; it is not blocked, and the note
 * must agree with the header's blocked count.
 */
function blockKind(climber: LadderClimber): ClimberBlock["kind"] | null {
  return climber.status === "blocked" && climber.blocked
    ? climber.blocked.kind
    : null;
}

/**
 * Why this ladder is not currently producing runs, or null when nothing needs saying.
 *
 * A ladder climbs by itself, so the note never asks anyone to review anything. It
 * names the four things no control on the board shows: climbers that are blocked
 * (grouped by reason, each with its fix), runs the in-flight cap is holding back, an
 * enabled ladder with runs to launch and none in flight (no finishing run will feed
 * it, so a stall is never silent), and a climb that has finished. Every climber stopped is the ladder having *answered its
 * question*, not a fault, and saying so is the difference between reading a result
 * and hunting a bug. Being disabled is not one: the Enabled switch already says so,
 * and a note repeating a control's state is noise.
 */
export function ladderStatusNote(
  progress: LadderProgress,
  enabled = false,
): string | null {
  const counts = new Map<ClimberBlock["kind"], number>();
  for (const climber of progress.climbers) {
    const kind = blockKind(climber);
    if (kind) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const stuck = [...counts.values()].reduce((n, c) => n + c, 0);
  const blocked =
    stuck > 0
      ? ` ${stuck} climber${stuck === 1 ? " is" : "s are"} blocked. ` +
        BLOCK_ORDER.filter((k) => counts.has(k))
          .map((k) => BLOCK_NOTES[k](counts.get(k)!))
          .join(" ")
      : "";

  const count = (status: LadderClimber["status"]) =>
    progress.climbers.filter((c) => c.status === status).length;
  const climbing = count("climbing");
  if (climbing === 0 && progress.climbers.length > 0) {
    const parts = [
      `${progress.climbersWalled} walled`,
      `${progress.climbersToppedOut} topped out`,
    ];
    const blockedNow = count("blocked");
    if (blockedNow > 0) parts.push(`${blockedNow} blocked`);
    const held = count("held");
    if (held > 0) parts.push(`${held} held`);
    const listed = `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
    return blockedNow > 0
      ? `Nobody is climbing: ${listed}. The blocked climbers have not finished; each needs the fix below.${blocked}`
      : `Nobody is climbing: ${listed}. This ladder has answered its question. ` +
          "Promote a climber past a wall, release a hold, or add rungs to ask a " +
          `harder one.${blocked}`;
  }
  if (
    progress.runsMissing > 0 &&
    bufferIsFull(progress.bufferTarget, progress.runsInFlight)
  ) {
    return (
      `${progress.runsInFlight} of ${formatBufferTarget(progress.bufferTarget)} runs ` +
      "are in flight, the most this ladder runs at once. It launches the rest by " +
      `itself as these finish.${blocked}`
    );
  }
  if (enabled && progress.runsMissing > 0 && progress.runsInFlight === 0) {
    return (
      "Nothing is in flight, so no finishing run will feed this ladder. Press " +
      `“Top up now” to launch the runs the climb needs next.${blocked}`
    );
  }
  return blocked.trim() || null;
}

/**
 * The combination a steering or override call names, rebuilt from a climber.
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

// One rung inside an expanded climber: what happened on it, the evidence behind that,
// the runs that are that evidence, and the controls that disagree with it. A rung the
// climber has not reached yet is still listed — greyed and without controls — because
// the rungs *ahead* are what the climb is for, and hiding them would make a walled
// climber look like a finished one.
function RungRow({
  view,
  climber,
  busy,
  editTo,
  onOverride,
  onBump,
}: {
  view: RungView;
  climber: LadderClimber;
  busy: boolean;
  /** Where the ladder is edited, for the "Replace rung" fix; absent offers none. */
  editTo?: string;
  onOverride: (rungId: string, outcome: "advanced" | "walled" | null) => void;
  onBump: (rung: LadderProgressRung) => void;
}) {
  const testCaseName = useTestCaseName();
  // The runs are fetched only once asked for: a long climb holds a rung per case, and
  // a board that queried every one of them on expand would spend a request per rung to
  // fill a list nobody had looked at.
  const [runsOpen, setRunsOpen] = useState(false);
  const { rung, outcome, history, current, tally, reached } = view;
  const effective = outcome?.effective ?? null;

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

      {effective ? (
        <span
          className={`${ladderStyles.verdict} ${
            effective === "advanced"
              ? ladderStyles.verdictAdvanced
              : ladderStyles.verdictWalled
          }`}
        >
          {effective === "advanced" ? "advanced" : "walled"}
        </span>
      ) : (
        <span
          className={`${ladderStyles.verdict} ${ladderStyles.verdictUndecided}`}
        >
          {current
            ? "not decided yet"
            : reached
              ? "in progress"
              : "not reached"}
        </span>
      )}

      {/* An override is the only note that changes what governs the climb, and it
          always states what the gate itself said — the disagreement between reviewer
          and gate is kept legible rather than resolved silently. */}
      {outcome?.overrideOutcome && (
        <span className={ladderStyles.overrideNote}>
          by hand (the gate said {outcome.outcome})
        </span>
      )}
      {outcome && !outcome.recorded && (
        <span
          className={ladderStyles.verdictNote}
          title="Computed from the validators' ratings for this view. The next top-up writes it down; reading a board never writes."
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
          {history.map((h) => `${h.decidedVersion} ${h.effective}`).join(", ")}
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
            handing the reviewer off to a filtered Runs page: the question a rung
            raises ("why did this wall?") is answered by its own runs, and answering
            it should not cost the board the reviewer was reading. */}
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
        {/* Promote is the upward half of manual control and needs something to
            promote *past*: an undecided rung has no verdict to override, and the
            control for "stop here regardless" is the hold on the row above. */}
        {outcome && effective === "walled" && (
          <button
            type="button"
            className={ladderStyles.rungLink}
            disabled={busy}
            title="Advance this climber past a rung its runs failed. Recorded beside the gate's own verdict, never in place of it."
            onClick={() => onOverride(rung.id, "advanced")}
          >
            Promote anyway
          </button>
        )}
        {outcome && effective === "advanced" && (
          <button
            type="button"
            className={ladderStyles.rungLink}
            disabled={busy}
            title="Wall this climber here despite its runs clearing the bar."
            onClick={() => onOverride(rung.id, "walled")}
          >
            Wall here
          </button>
        )}
        {outcome?.overrideOutcome && (
          <button
            type="button"
            className={ladderStyles.rungLink}
            disabled={busy}
            title="Remove your override and restore exactly what the gate says."
            onClick={() => onOverride(rung.id, null)}
          >
            Clear override
          </button>
        )}
      </span>

      {runsOpen && <RungRuns rung={rung} climber={climber} />}
    </li>
  );
}

// One climber's row on the board: its identity, where it stands, and how far it got,
// over the steering that decides whether and when it climbs next. Starts collapsed —
// the header alone answers the dashboard's question, and the per-rung evidence is what
// you open when you want to argue with it.
export function ClimberRow({
  climber,
  rungs,
  busy,
  editTo,
  onSteer,
  onOverride,
  onBump,
}: {
  climber: LadderClimber;
  rungs: LadderProgressRung[];
  busy: boolean;
  /** Where the ladder is edited, for the fixes that are an edit to it. */
  editTo?: string;
  onSteer: (climber: LadderClimber, steering: SteeringPatch) => void;
  onOverride: (
    climber: LadderClimber,
    rungId: string,
    outcome: "advanced" | "walled" | null,
  ) => void;
  onBump: (rung: LadderProgressRung) => void;
}) {
  const [open, setOpen] = useState(false);
  const cleared = climber.currentRung?.position ?? rungs.length;
  const views = buildRungViews(climber, rungs);
  const status = climberStatusLabel(climber, rungs.length);
  const testCaseName = useTestCaseName();
  // Why the climber is not moving and what fixes it. Read off the climber, never off
  // its rung: a topped out or walled climber has no `currentRung` at all, and the
  // rung-scoped copy would silently vanish for exactly the climbers whose fault is
  // easiest to leave standing. A blocked climber's reason comes first; a combination
  // that cannot launch is named too when the block is something else (or the climber
  // is in another state), because it will stop the climb the moment that clears.
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
  // beside its status; a blocked one already says so in its status pill.
  const cannotLaunch =
    Boolean(climber.unlaunchable) && climber.status !== "blocked";

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
          <span className={ladderStyles.climberTitle}>
            {comboLabel(climber)}
          </span>
          {climber.provider && (
            <span className={ladderStyles.climberMeta}>{climber.provider}</span>
          )}
          {/* Only the states that say something the track cannot: a wall, a block,
              a hold, a finished climb. */}
          {status && (
            <span
              className={`${ladderStyles.statusPill} ${statusClass(climber)}`}
              title={reasons[0]}
            >
              {status}
            </span>
          )}
          {/* A held, walled or finished climber whose combination cannot launch: it
              rides beside the status rather than replacing it, because the fault is
              in the membership and the climber's own state is still worth saying. */}
          {cannotLaunch && (
            <span
              className={`${ladderStyles.statusPill} ${ladderStyles.statusBlocked}`}
              title={climber.unlaunchable}
            >
              Cannot launch
            </span>
          )}
          {/* One segment per rung, so the wall is a position on a line rather than a
              number to be read: the first non-green segment is where this model
              stopped. */}
          <span
            className={ladderStyles.rungTrack}
            aria-hidden
            title={`${cleared} of ${rungs.length} rungs cleared`}
          >
            {rungs.map((rung, index) => (
              <span
                key={rung.id}
                className={`${ladderStyles.rungStep} ${
                  index < cleared
                    ? ladderStyles.rungStepDone
                    : index === cleared && climber.status === "walled"
                      ? ladderStyles.rungStepWall
                      : index === cleared && climber.status === "blocked"
                        ? ladderStyles.rungStepBlocked
                        : index === cleared
                          ? ladderStyles.rungStepCurrent
                          : ""
                }`}
              />
            ))}
          </span>
          <span className={ladderStyles.rungCount}>
            {cleared}/{rungs.length} rungs
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
            className={exec.secondary}
            disabled={busy}
            title={
              climber.held
                ? "Let this climber carry on from exactly where it stopped."
                : "Stop this climber where it stands. Nothing is decided and nothing is cancelled; releasing it resumes the climb."
            }
            onClick={() => onSteer(climber, { held: !climber.held })}
          >
            {climber.held ? "Release" : "Hold"}
          </button>
        </span>
      </div>

      {/* The reason gets a line of its own under the header, as a blocked cell's does
          on the plan matrix: it is a sentence naming the fault and its fix, not a
          badge, and nobody can act on it truncated into the header's row. Shown
          collapsed, because the whole failure of this state is that it is invisible
          until somebody thinks to look. A rung that needs replacing links straight to
          the editor that replaces it. */}
      {reasons.map((reason) => (
        <p key={reason} className={ladderStyles.climberBlocked}>
          {reason}
          {block?.kind === "unsupportedRung" &&
            reason === reasons[0] &&
            editTo && (
              <>
                {" "}
                <Link to={editTo}>Replace the rung</Link>
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
              onOverride={(rungId, outcome) =>
                onOverride(climber, rungId, outcome)
              }
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
  held?: boolean;
}

// The per-ladder climb dashboard (`/account/ladders/:ladderId`): one row per climber
// saying where it stands and why, over the controls that feed the ladder (enable /
// disable, top up, halt) and the runs left to label. Console-only; gated on a
// signed-in account, because a ladder belongs to one.
//
// Opening this page is a read and only a read. An enabled ladder is fed at three
// moments: when it is enabled, when "Top up now" is pressed, and — with nobody
// watching — by the backend itself whenever a run of one of its cells finishes. None
// of them is a review: the validators rate every completed run, and that rating is
// all the gate reads.
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
  // The last thing a control did (topped up, halted, promoted), reported verbatim:
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

  // The backend then tops the ladder up itself, a moment *after* the run finished, and
  // the runs it launches arrive on the same stream as newly queued runs. The finished
  // event's re-read can land before that top-up has enqueued anything, so the board
  // also re-reads whenever the set of runs in flight changes. Debounced, because a
  // top-up enqueues a whole rung's runs at once and one re-read covers them all.
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

  // Run the server-side top-up. `announce` is on for the button, which must always
  // answer, even to say "nothing to do"; a top-up run as a side effect of something
  // else — enabling the ladder — speaks only when it actually enqueued, because the
  // switch moving is already the answer to that press.
  const topUp = useCallback(
    async (announce: boolean) => {
      if (!backend?.topUpLadder || !token) return;
      setBusy(true);
      setError(null);
      try {
        const result = await backend.topUpLadder(ladderId, token);
        if (announce || result.enqueued > 0)
          setNote(describeLadderTopUp(result));
        if (result.enqueued > 0) await refresh();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [backend, token, ladderId, refresh],
  );

  // Opening the dashboard deliberately enqueues **nothing**. A ladder is fed by
  // enabling it, by pressing "Top up now", and by the backend as its runs finish.
  // Reading a board is none of those, and a page that spent tokens because it was
  // looked at is a page nobody can open to check on a run they have deliberately
  // stopped.

  // Enable or disable the ladder: the one switch that decides whether it may enqueue at
  // all. Takes the state rather than toggling, so the control cannot disagree with the
  // server about which way it goes.
  //
  // Enabling immediately tops up, because "enabled" and "climbing" are the same thing
  // to a reviewer — the alternative leaves a ladder that says it is on and does nothing
  // until someone finds a second button. Disabling writes only the flag: whatever is
  // already queued carries on, and cancelling it is what Halt is for. Neither says
  // anything: the switch is the state, and its tooltip is the explanation.
  const setEnabled = useCallback(
    async (enabled: boolean) => {
      if (!backend?.pauseLadder || !token) return;
      setBusy(true);
      setError(null);
      try {
        const schedule = await backend.pauseLadder(ladderId, !enabled, token);
        setLadder((l) => (l ? { ...l, ...schedule } : l));
        if (!enabled) return;
      } catch (e) {
        setError(String(e));
        return;
      } finally {
        setBusy(false);
      }
      // Outside the guard above, so the top-up's own busy/error handling owns the rest
      // of the gesture.
      await topUp(false);
    },
    [backend, token, ladderId, topUp],
  );

  // Turn "climb automatically as runs finish" on or off: whether the backend tops this
  // ladder up itself each time one of its runs finishes. Written through the schedule
  // resource (not the ladder save), so it can never be clobbered by a climb edit saved
  // from another tab.
  //
  // The schedule is written whole, so the rest of it is read back at the moment of the
  // write rather than taken from the page's load: a ladder disabled or halted in another
  // tab since this page opened must not be re-enabled by flipping this switch, and the
  // backend tops an enabled ladder up as soon as its schedule is written.
  const setAutoTopUp = useCallback(
    async (autoTopUp: boolean) => {
      if (!backend?.setLadderSchedule || !token || !ladder) return;
      setBusy(true);
      setError(null);
      try {
        const current: LadderSchedule = (await backend.getLadderSchedule?.(
          ladderId,
          token,
        )) ?? {
          outerAxis: ladder.outerAxis,
          paused: ladder.paused,
          autoTopUp: ladder.autoTopUp,
          ...(ladder.bufferTarget === undefined
            ? {}
            : { bufferTarget: ladder.bufferTarget }),
        };
        const schedule: LadderSchedule = { ...current, autoTopUp };
        const saved = await backend.setLadderSchedule(
          ladderId,
          schedule,
          token,
        );
        setLadder((l) => (l ? { ...l, ...saved } : l));
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [backend, token, ladderId, ladder],
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
            held: patch.held ?? climber.held,
          },
          token,
        );
        // A hold changes a climber's status and a priority changes the board's order,
        // so the board is re-read rather than patched locally.
        await refresh();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [backend, token, ladderId, refresh],
  );

  // Apply or clear a manual override of one rung's verdict. Stored beside the gate's
  // own verdict rather than replacing it, so a later recompute can never silently undo
  // it and clearing restores exactly what the gate says.
  const override = useCallback(
    async (
      climber: LadderClimber,
      rungId: string,
      outcome: "advanced" | "walled" | null,
    ) => {
      if (!backend?.setLadderOutcome || !token) return;
      setBusy(true);
      setError(null);
      try {
        await backend.setLadderOutcome(
          ladderId,
          {
            combination: climberCombo(climber),
            rungId,
            ...(outcome === null ? {} : { outcome }),
          },
          token,
        );
        const named = comboLabel(climber);
        setNote(
          outcome === null
            ? `Override cleared. ${named} is back to whatever the gate says on that rung.`
            : `${named} ${outcome === "advanced" ? "promoted past" : "walled at"} that rung by hand. The gate's own verdict is kept beside yours.`,
        );
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
      {/* The note stays a plain notice: a top-up runs on open with no press behind
        it, and a note that revealed itself would pull a reader who had already
        scrolled down back to the top of the page. */}
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
          <div className={styles.summary}>
            <span className={styles.summaryStat}>
              <strong>{progress.climbers.length}</strong> climbers
            </span>
            <span
              className={styles.summaryStat}
              title="Climbers the gate has stopped. Expand one to see the rung and the evidence behind it."
            >
              <strong>{progress.climbersWalled}</strong> walled
            </span>
            <span className={styles.summaryStat}>
              <strong>{progress.climbersToppedOut}</strong> topped out
            </span>
            {/* Only when there are any: a blocked climber is the one state nothing
                clears by itself, and a standing "0 blocked" would train the eye to
                skip the figure on the day it is not zero. */}
            {progress.climbersBlocked > 0 && (
              <span
                className={styles.summaryStat}
                title="Climbers standing on an undecided rung that nothing the ladder does by itself will move. Each row says why, and what fixes it."
              >
                <strong>{progress.climbersBlocked}</strong> blocked
              </span>
            )}
            <span className={styles.summaryStat}>
              <strong>{progress.runsMissing}</strong> runs missing
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
          </div>

          <div className={styles.controls}>
            <span className={styles.controlOrder}>
              Climbs in this order:{" "}
              <strong>{ladderAxisLabel(progress.outerAxis)}</strong>
            </span>
            <label
              className={`${styles.controlToggle} ${styles.controlEnd}`}
              htmlFor={enabledId}
              title="On: this ladder may enqueue runs. Switching it on tops it up at once, and it climbs from there by itself as its runs finish. Off: nothing more is enqueued; runs already queued carry on. A new ladder starts off."
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
            <label
              className={styles.controlToggle}
              title="On: whenever one of this ladder's runs finishes, the backend launches whatever the climb needs next, up to the runs-in-flight cap, with no console open. Off: the ladder is fed only by switching it on and by “Top up now”."
            >
              <input
                type="checkbox"
                checked={ladder?.autoTopUp ?? false}
                disabled={busy || !ladder || !backend?.setLadderSchedule}
                onChange={(e) => void setAutoTopUp(e.target.checked)}
              />
              Climb automatically as runs finish
            </label>
            <span className={styles.controlActions}>
              <button
                type="button"
                // A disabled ladder makes enabling the primary gesture, and topping one
                // up is not offered at all: it could only enqueue nothing and say so,
                // which is a button whose whole function is to report its own futility.
                className={exec.primary}
                disabled={
                  busy || !backend?.topUpLadder || ladder?.paused !== false
                }
                title={
                  ladder?.paused
                    ? "This ladder is off, so it can enqueue nothing. Switch it on, which tops it up too."
                    : "Enqueue the next runs this climb needs, up to the runs-in-flight cap. Also relaunches a rung whose runs kept failing."
                }
                onClick={() => void topUp(true)}
              >
                {busy ? "Working…" : "Top up now"}
              </button>
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
            <p className={`${exec.notice} ${exec.warn}`}>{statusNote}</p>
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
                onOverride={(c, rungId, outcome) =>
                  void override(c, rungId, outcome)
                }
                onBump={(rung) => void bumpRung(rung)}
              />
            ))}
          </div>
        </>
      )}
    </PageLayout>
  );
}
