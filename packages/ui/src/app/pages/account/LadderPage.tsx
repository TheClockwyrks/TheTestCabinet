import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import type {
  CoverageQueue,
  HaltResult,
  ReviewPlanCombo,
  TopUpResult,
} from "@test-cabinet/run-record/coverage";
import type {
  LadderClimber,
  LadderOut,
  LadderProgress,
  LadderProgressRung,
  LadderRungOutcome,
  LadderSchedule,
  RungTally,
} from "@test-cabinet/run-record/ladders";
import type { BackendClient } from "../../../client/clients";
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
import { ReviewQueue } from "./CoveragePlanPage";
import { RungRuns } from "./LadderRungRuns";
import { ladderAxisLabel } from "./ladderPickers";
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
// a different product: the same buffer, the same top-up, the same review loop, over an
// ordered climb instead of a matrix.

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
    case "awaitingReview":
      return `Rung ${at} — waiting on your review`;
    case "climbing":
      return null;
    case "toppedOut":
      return `Topped out — all ${rungCount} rungs cleared`;
  }
}

/** The status pill's colour class, one per state (see `Ladder.module.scss`). */
function statusClass(climber: LadderClimber): string {
  switch (climber.status) {
    case "held":
      return ladderStyles.statusHeld!;
    case "walled":
      return ladderStyles.statusWalled!;
    case "awaitingReview":
      return ladderStyles.statusAwaiting!;
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
 * are the ladder's problem, runs waiting on a review are yours, and the required count
 * is what the two knobs of the gate actually add up to on this rung. A reviewer who
 * disagrees with a wall needs all of them to see where the disagreement is.
 */
export function describeTally(tally: RungTally): string {
  const parts = [
    `${tally.completed} run${tally.completed === 1 ? "" : "s"} in`,
    `${tally.passing} of ${tally.judged} judged clear the bar (${tally.required} needed)`,
  ];
  if (tally.unjudged > 0) {
    parts.push(`${tally.unjudged} waiting on your review`);
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
 * when in truth every model has stopped would be actively misleading.
 */
export function describeLadderTopUp(result: TopUpResult): string {
  if (result.skipped === "paused") {
    return "This ladder is disabled, so nothing was enqueued. Enable it to let it climb.";
  }
  if (result.skipped === "busy") {
    return "A top-up for this ladder was already running — nothing was enqueued twice.";
  }
  if (result.enqueued > 0) {
    const runs = `${result.enqueued} run${result.enqueued === 1 ? "" : "s"}`;
    const rungs = `${result.cells.length} rung${result.cells.length === 1 ? "" : "s"}`;
    return `Enqueued ${runs} across ${rungs}, in the order this ladder climbs them.`;
  }
  const outstanding = result.outstanding ?? 0;
  if (outstanding >= result.bufferTarget) {
    return (
      `Nothing enqueued: your review buffer is full (${outstanding} of ` +
      `${result.bufferTarget} outstanding). Review some runs and top up again.`
    );
  }
  return (
    "Nothing left to enqueue — every climber is at its rung's target, walled, " +
    "held, or topped out."
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
    return `Disabled. No jobs of this ladder were waiting to cancel (${scope}).`;
  }
  const jobs = `${result.canceled} job${result.canceled === 1 ? "" : "s"}`;
  return `Disabled and canceled ${jobs} ${scope}.`;
}

/**
 * Why this ladder is not currently producing runs, or null when nothing needs saying.
 *
 * A ladder has one idle state a plan does not: every climber stopped. That is the
 * ladder having *answered its question*, not a fault, and saying so is the difference
 * between a reviewer reading a result and a reviewer hunting a bug. The others match
 * the plan's — disabled, or a full review buffer waiting on them.
 */
export function ladderStatusNote(
  progress: LadderProgress,
  paused: boolean,
): string | null {
  if (paused) {
    return (
      "Disabled: this ladder will not enqueue anything until you enable it — which a " +
      "new ladder never has been. Whatever is already queued is untouched."
    );
  }
  const climbing = progress.climbers.filter(
    (c) => c.status === "climbing" || c.status === "awaitingReview",
  ).length;
  if (climbing === 0 && progress.climbers.length > 0) {
    return (
      `Nobody is climbing: ${progress.climbersWalled} walled, ` +
      `${progress.climbersToppedOut} topped out, and the rest held. This ladder has ` +
      "answered its question — promote a climber past a wall, release a hold, or add " +
      "rungs to ask a harder one."
    );
  }
  if (
    progress.runsMissing > 0 &&
    progress.runsOutstanding >= progress.bufferTarget
  ) {
    return (
      `Waiting on you: ${progress.runsOutstanding} of ${progress.bufferTarget} ` +
      "buffered runs are outstanding (in flight, or finished and unreviewed), so a " +
      "top-up deliberately enqueues nothing until you review some. A rung's verdict " +
      "is your review — nothing else can decide it."
    );
  }
  return null;
}

/** The combination a steering or override call names, rebuilt from a climber. */
function climberCombo(climber: LadderClimber): ReviewPlanCombo {
  return {
    harness: climber.harness,
    model: climber.model,
    ...(climber.provider ? { provider: climber.provider } : {}),
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
  onOverride,
  onBump,
}: {
  view: RungView;
  climber: LadderClimber;
  busy: boolean;
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
      <span className={ladderStyles.rungName}>
        {testCaseName(rung.slug)} · {rung.variant} · {rung.version}
      </span>

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
          title="Computed from your reviews for this view. The next top-up writes it down; reading a board never writes."
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
  onSteer,
  onOverride,
  onBump,
}: {
  climber: LadderClimber;
  rungs: LadderProgressRung[];
  busy: boolean;
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
            {climber.harness} · {climber.model}
          </span>
          {climber.provider && (
            <span className={ladderStyles.climberMeta}>{climber.provider}</span>
          )}
          {/* Only the states that say something the track cannot: a wall, a hold, a
              rung waiting on the reviewer, a finished climb. */}
          {status && (
            <span
              className={`${ladderStyles.statusPill} ${statusClass(climber)}`}
            >
              {status}
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
            aria-label={
              climber.focused
                ? `Stop watching ${climber.model}`
                : `Watch ${climber.model}`
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

      {open && (
        <ol className={ladderStyles.rungList}>
          {views.map((view) => (
            <RungRow
              key={view.rung.id}
              view={view}
              climber={climber}
              busy={busy}
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
        aria-label={`Climb priority for ${climber.model}`}
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

/**
 * Top up every ladder of the signed-in account that asked to be topped up on review.
 *
 * The ladder half of the plan's `topUpAfterReview`, and the moment that matters most:
 * there is no background scheduler, so an enabled ladder is fed by exactly three
 * gestures — enabling it, pressing "Top up now", and this — and on a ladder the review
 * *is* the verdict, so it may well have decided a rung and freed the climber to move up.
 *
 * The `paused` skip is what keeps a **disabled** ladder — which every new ladder is —
 * from being started by a review of something else entirely. `autoTopUp` is on by
 * default, and it is the enable switch, not this flag, that decides whether a ladder
 * spends anything at all.
 *
 * Failures are swallowed on purpose: this runs after a review has been accepted, and a
 * scheduling hiccup must never present itself as the review having failed. Resolves
 * how many runs were enqueued in total, for a caller that wants to say so.
 */
export async function topUpLaddersAfterReview(
  backend: BackendClient | null,
  token: string | null,
): Promise<number> {
  if (!backend?.listLadders || !backend.topUpLadder || !token) return 0;
  let enqueued = 0;
  try {
    const ladders = await backend.listLadders(token);
    for (const entry of ladders) {
      if (!entry.autoTopUp || entry.paused) continue;
      const result = await backend.topUpLadder(entry.id, token);
      enqueued += result.enqueued;
    }
  } catch {
    // Deliberately silent — see above.
  }
  return enqueued;
}

// The per-ladder climb dashboard (`/account/ladders/:ladderId`): one row per climber
// saying where it stopped and why, over the controls that feed the ladder (enable /
// disable, top up, halt) and the review queue it has filled. Console-only; gated on a
// signed-in account, because a rung's verdict is computed from *your* reviews alone.
//
// Opening this page is a read and only a read. Every run this ladder launches is
// launched by a gesture that asked for runs — enabling the ladder, topping it up by
// hand, or submitting a review with auto-top-up on.
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
  // open, the same way the Runs section declares it. Without it a rung's runs would be
  // a snapshot taken when it was expanded: a queued run would never be seen to start,
  // and a finished one would sit in the list as "running" until someone navigated.
  useLiveRunUpdates();
  const { refreshToken } = useRunsRuntime();

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
  // and the review queue the buffer has filled.
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

  // A run of this ladder finishing is the one event that moves the board without anyone
  // touching it: the tally gains a completed run, and a rung whose gate that settles
  // changes verdict. The runs runtime bumps `refreshToken` on the stream's `finished`
  // events, so re-read the board on it — skipping the mount, which the load above has
  // just done.
  const seenRefresh = useRef(refreshToken);
  useEffect(() => {
    if (seenRefresh.current === refreshToken) return;
    seenRefresh.current = refreshToken;
    void refresh();
  }, [refreshToken, refresh]);

  // Run the server-side top-up. `announce` is on for every gesture that asked for runs
  // — the button, and enabling the ladder — because such a gesture must always answer,
  // even to say "nothing to do"; a top-up run as a side effect of something else speaks
  // only when it actually enqueued.
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

  // Opening the dashboard deliberately enqueues **nothing**. A ladder is only ever fed
  // by a gesture that says so: enabling it, pressing "Top up now", or — once it is
  // enabled — submitting a review. Reading a board is none of those, and a page that
  // spent tokens because it was looked at is a page nobody can open to check on a run
  // they have deliberately stopped.

  // Enable or disable the ladder: the one switch that decides whether it may enqueue at
  // all. Takes the state rather than toggling, so the control cannot disagree with the
  // server about which way it goes.
  //
  // Enabling immediately tops up, because "enabled" and "climbing" are the same thing
  // to a reviewer — the alternative leaves a ladder that says it is on and does nothing
  // until someone finds a second button. Disabling writes only the flag: whatever is
  // already queued carries on, and cancelling it is what Halt is for.
  const setEnabled = useCallback(
    async (enabled: boolean) => {
      if (!backend?.pauseLadder || !token) return;
      setBusy(true);
      setError(null);
      try {
        const schedule = await backend.pauseLadder(ladderId, !enabled, token);
        setLadder((l) => (l ? { ...l, ...schedule } : l));
        if (!enabled) {
          setNote(
            "Disabled. Nothing new will be enqueued; runs already queued carry on.",
          );
          return;
        }
      } catch (e) {
        setError(String(e));
        return;
      } finally {
        setBusy(false);
      }
      // Outside the guard above, so the top-up's own busy/error handling owns the rest
      // of the gesture and its result is what the reviewer is told about.
      await topUp(true);
    },
    [backend, token, ladderId, topUp],
  );

  // Turn "top up when I submit a review" on or off. Written through the schedule
  // resource (not the ladder save), so it can never be clobbered by a climb edit saved
  // from another tab.
  const setAutoTopUp = useCallback(
    async (autoTopUp: boolean) => {
      if (!backend?.setLadderSchedule || !token || !ladder) return;
      const schedule: LadderSchedule = {
        outerAxis: ladder.outerAxis,
        paused: ladder.paused,
        autoTopUp,
        ...(ladder.bufferTarget === undefined
          ? {}
          : { bufferTarget: ladder.bufferTarget }),
      };
      setBusy(true);
      setError(null);
      try {
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
        setNote(
          outcome === null
            ? `Override cleared — ${climber.model} is back to whatever the gate says on that rung.`
            : `${climber.model} ${outcome === "advanced" ? "promoted past" : "walled at"} that rung by hand. The gate's own verdict is kept beside yours.`,
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
            rungs: ladder.rungs.map((r) => ({
              id: r.id,
              slug: r.slug,
              version: r.id === rung.id ? rung.latestVersion : r.version,
              variant: r.variant,
              ...(r.runs === undefined ? {} : { runs: r.runs }),
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
          Sign in to view a ladder — a rung is decided by <em>your</em> reviews,
          so there is nothing to show without an account.
        </p>
      </PageLayout>
    );
  }

  const statusNote = progress
    ? ladderStatusNote(progress, ladder?.paused ?? false)
    : null;

  return (
    <PageLayout>
      <header className={styles.detailHeader}>
        <div className={styles.detailTitleRow}>
          <BackChevron to={routes.accountLadders()} label="All ladders" />
          <h1 className={styles.detailTitle}>{ladder?.name ?? ladderId}</h1>
          {ladder?.paused && (
            <span className={styles.pausedBadge}>disabled</span>
          )}
        </div>
        <Link
          className={exec.secondary}
          to={routes.accountLadderEdit(ladderId)}
        >
          Edit ladder
        </Link>
      </header>

      {error && <p className={`${exec.notice} ${exec.error}`}>{error}</p>}
      {note && <p className={`${exec.notice} ${exec.ok}`}>{note}</p>}

      {loading ? (
        <LoadingState label="Loading the climb…" />
      ) : !progress || progress.rungs.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.empty}>
            This ladder has no rungs yet. Edit it to pin the cases you want
            climbed, easiest first — the order is the climb.
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
            <span className={styles.summaryStat}>
              <strong>{progress.runsMissing}</strong> runs missing
            </span>
            <span
              className={styles.summaryStat}
              title="Runs waiting on you or on the queue: in flight (queued, pending, or executing) plus finished but unreviewed by you. A top-up stops once this reaches the buffer target."
            >
              <strong>
                {progress.runsOutstanding}/{progress.bufferTarget}
              </strong>{" "}
              buffered
            </span>
            <span
              className={styles.summaryStat}
              title="Completed runs of this ladder you have not reviewed. On a ladder these are also the undecided rungs — your review is the verdict."
            >
              <strong>{progress.runsUnreviewed}</strong> to review
            </span>
          </div>

          <div className={styles.controls}>
            <span className={styles.controlOrder}>
              Climbs in this order:{" "}
              <strong>{ladderAxisLabel(progress.outerAxis)}</strong>
            </span>
            <label className={`${styles.controlToggle} ${styles.controlEnd}`}>
              <input
                type="checkbox"
                checked={ladder?.autoTopUp ?? false}
                disabled={busy || !ladder || !backend?.setLadderSchedule}
                onChange={(e) => void setAutoTopUp(e.target.checked)}
              />
              Top up when I submit a review
            </label>
            <span className={styles.controlActions}>
              <button
                type="button"
                // A disabled ladder makes enabling the primary gesture, and topping one
                // up is not offered at all: it could only enqueue nothing and say so,
                // which is a button whose whole function is to report its own futility.
                className={ladder?.paused ? exec.secondary : exec.primary}
                disabled={
                  busy || !backend?.topUpLadder || ladder?.paused !== false
                }
                title={
                  ladder?.paused
                    ? "This ladder is disabled, so it can enqueue nothing. Enable it — that tops it up too."
                    : "Enqueue the next runs this climb needs, up to the review buffer."
                }
                onClick={() => void topUp(true)}
              >
                {busy ? "Working…" : "Top up now"}
              </button>
              <button
                type="button"
                className={ladder?.paused ? exec.primary : exec.secondary}
                // Gated on the ladder having loaded: the control sends a state, not a
                // toggle, and it cannot know which state to send until it knows the
                // one the ladder is in.
                disabled={busy || !ladder || !backend?.pauseLadder}
                title={
                  ladder?.paused
                    ? "Let this ladder enqueue runs, and top it up now."
                    : "Stop this ladder enqueueing anything more. Runs already queued carry on."
                }
                onClick={() => void setEnabled(Boolean(ladder?.paused))}
              >
                {ladder?.paused ? "Enable" : "Disable"}
              </button>
              <button
                type="button"
                className={exec.secondary}
                disabled={busy || !backend?.haltLadder}
                title="Disable, and cancel this ladder's jobs that have not started yet."
                onClick={() => void halt(false)}
              >
                Halt
              </button>
              <button
                type="button"
                className={exec.danger}
                disabled={busy || !backend?.haltAllLadder}
                title="Disable, and cancel every job this ladder launched — runs already executing included."
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
            <ReviewQueue queue={queue} returnLabel="Back to the ladder" />
          )}

          <div className={ladderStyles.climbers}>
            {progress.climbers.map((climber) => (
              <ClimberRow
                key={climber.key}
                climber={climber}
                rungs={progress.rungs}
                busy={busy}
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
