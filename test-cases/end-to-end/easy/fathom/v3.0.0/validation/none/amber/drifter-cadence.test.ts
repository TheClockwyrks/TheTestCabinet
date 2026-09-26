// amber/drifter-cadence — drifters are admitted on the DRIFTER_INTERVAL cadence.
//
// specs/gameplay.md: "While plankton remain in the maze, drifters are admitted at
// the den gate on a cadence of `DRIFTER_INTERVAL` (`25 s`)." The figure is what
// paces the bluff: a maze that tops itself up every few seconds hands the player
// a stream of free bonuses, and one that never does takes the second amber light
// out of the game.
//
// THE CADENCE IS READ OFF ITS OWN COUNTDOWN RATHER THAN WAITED OUT. specs/state.md
// puts `drifterIn` on the snapshot — "the seconds left on the bonus-drifter
// cadence: the countdown that admits the next drifter at the den gate" — and
// specs/instrumentation.md's `setDrifterIn` poses it. That is the number the
// admission itself runs off rather than a figure kept beside it, so the gap
// between two admissions is decided by three readings taken across a few seconds
// instead of by sitting through seventy-five of them:
//
//   1. AN ADMISSION LANDS WHEN THE COUNTDOWN REACHES ZERO. The countdown is posed
//      a short lead from expiry and the maze is read finely; the drifter arrives
//      as the lead runs out, and it does so on each of ADMISSIONS occasions.
//   2. EACH ADMISSION RE-ARMS THE COUNTDOWN TO DRIFTER_INTERVAL, read off the
//      snapshot on the step the drifter appeared.
//   3. THE COUNTDOWN RUNS DOWN IN REAL SECONDS, measured against the simulation's
//      own accumulated time over a stretch of ordinary play.
//
// Composed, those three are the claim: an admission happens when the countdown
// reaches zero, and zero is reached DRIFTER_INTERVAL of game time after the
// previous admission armed it. A build admitting on a cadence of its own fails
// (1), one re-arming to some other figure fails (2), and one whose countdown is
// not in seconds fails (3) — and each of them names the cause.
//
// WHY NOT SIT THROUGH THE INTERVALS. Two consecutive gaps are seventy-five
// seconds of play, which is nine thousand ticks of a full board simulated and
// drawn for a reading that three cheap ones settle. The check is the same one
// either way, and this one is the one that fits a validator's budget.
//
// THE MAZE IS EMPTIED OF DRIFTERS AFTER EACH ADMISSION, so `DRIFTER_MAX` (`2`)
// never stops the cadence. `clearDrifters` is what does it, and it is the right
// operation for the job: specs/instrumentation.md has it take every drifter off
// the maze WITHOUT eating any, and says in as many words that "the cadence tops
// the maze back up on its own schedule from there" — so it leaves the very clock
// this point is timing untouched. Eating them instead would put the forager on
// whatever tile the admission chose, and specs/gameplay.md fixes only that a
// drifter arrives "at the den gate" rather than which tile that is, so the check
// would depend on a layout decision the specification leaves to the build.
//
// THE BOARD IS THE GAME'S OWN, because the cadence runs on the maze the build laid
// out and its condition is that "plankton remain" there. The roster is taken off
// it, which specs/instrumentation.md's `clearPredators` does without touching the
// plankton: a released hunter would otherwise reach the forager and end the dive
// under the measurement.

import { afterEach, beforeEach, it } from "vitest";

import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { DRIFTER_INTERVAL, TICK_HZ, ticksFor } from "../constants";
import {
  captureReplay,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";

/** How many admissions are timed. */
const ADMISSIONS = 3;

/**
 * The lead the countdown is posed with before each admission, in seconds.
 *
 * Half a second: long enough that the arrival is a countdown running out rather
 * than the pose itself, and short enough that three of them cost a fraction of a
 * second of wall clock.
 */
const LEAD_SECONDS = 0.5;
const LEAD_TICKS = ticksFor(LEAD_SECONDS);

/** How far past the lead an arrival is waited for, in ticks: a whole second. */
const OVERRUN_TICKS = ticksFor(1);

/** How often the maze is read while the lead runs out, in ticks. */
const POLL_STEP = 6;

/**
 * The resolution the moment of an admission is read to, in seconds.
 *
 * A twentieth of a second, which is `POLL_STEP` ticks. It bounds both readings
 * taken at an admission: how far its arrival sat from the lead it was posed
 * with, and how far the countdown it re-armed sat from `DRIFTER_INTERVAL`.
 */
const POLL_SLACK = POLL_STEP / TICK_HZ;

/** The stretch the countdown's own rate is measured over, in ticks. */
const RUNDOWN_TICKS = ticksFor(5);

/**
 * How far the countdown's fall may sit from the game time that passed under it,
 * in seconds.
 *
 * One tick, which is float accumulation rather than a tolerance on the rule: the
 * countdown and `simTime` are stepped by the same `TICK_DT` on the same ticks.
 * Over the `5 s` stretch it bounds the rate to within a sixth of a percent, so
 * it costs a `DRIFTER_INTERVAL` gap under a twentieth of a second.
 */
const RATE_SLACK = 1 / TICK_HZ;

/**
 * The item's own tolerance on the gap between two admissions, in seconds.
 *
 * The three readings compose to a bound inside it: an admission fires at zero, a
 * re-arm lands within `POLL_SLACK` of `DRIFTER_INTERVAL`, and the countdown runs
 * down within a sixth of a percent of real time, so a gap sits within
 * `0.05 + 0.05` of the figure. The constant is named because it is the figure
 * the point is stated against.
 */
const GAP_TOLERANCE = 0.1;

/** Ticks of live play the clip carries around the last admission. */
const CLIP_TICKS = 60;

/** What one posed admission left behind. */
interface Admission {
  /** The simulated time the countdown was posed a lead from expiry at. */
  from: number;
  /** The simulated time the drifter appeared at, `null` if none did. */
  at: number | null;
  /** The countdown that admission re-armed, read on the step it appeared. */
  armed: number | null;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("admits drifters DRIFTER_INTERVAL apart while plankton remain", async () => {
  const opened = await startPlaying(h);
  // The roster off the board, so nothing can reach the forager while this runs.
  // The plankton are left exactly as the maze was laid out with them, because
  // the cadence runs only while they remain.
  await h.debug.clearPredators();
  await h.debug.clearDrifters();
  assertGreaterThan(
    opened.planktonRemaining,
    0,
    "plankton left in the maze the cadence is timed on, which is the " +
      "condition specs/gameplay.md admits a drifter under",
  );

  /**
   * Pose the countdown a lead from expiry, watch for the drifter, and report the
   * state the step it arrived on left.
   */
  const admission = async (): Promise<Admission> => {
    const posed = await h.snapshot();
    await h.debug.setDrifterIn(LEAD_SECONDS);
    for (
      let spent = 0;
      spent < LEAD_TICKS + OVERRUN_TICKS;
      spent += POLL_STEP
    ) {
      await h.advance(POLL_STEP);
      const seen = await h.snapshot();
      if (seen.drifters.length > 0) {
        return { from: posed.simTime, at: seen.simTime, armed: seen.drifterIn };
      }
    }
    return { from: posed.simTime, at: null, armed: null };
  };

  const seen: Admission[] = [];
  for (let index = 0; index < ADMISSIONS - 1; index += 1) {
    seen.push(await admission());
    await h.debug.clearDrifters();
  }
  seen.push(
    await captureReplay(h, "cadence", async () => {
      const landed = await admission();
      await h.advance(CLIP_TICKS);
      return landed;
    }),
  );

  for (let index = 0; index < seen.length; index += 1) {
    const one = seen[index];
    assertEqual(
      one.at !== null,
      true,
      `a drifter was admitted within ${String(LEAD_SECONDS)} s of the ` +
        `countdown being posed that far from expiry, on admission ` +
        `${String(index + 1)} of ${String(ADMISSIONS)} — specs/gameplay.md ` +
        "admits one at the den gate when the cadence comes round",
    );
    if (one.at === null || one.armed === null) return;
    assertLessThanOrEqual(
      Math.abs(one.at - one.from - LEAD_SECONDS),
      POLL_SLACK,
      `how far admission ${String(index + 1)} sat from the ` +
        `${String(LEAD_SECONDS)} s the countdown was posed with, measured on ` +
        "the simulation's own accumulated time: the admission is what the " +
        "countdown reaching 0 does (specs/state.md)",
    );
    assertLessThanOrEqual(
      Math.abs(one.armed - DRIFTER_INTERVAL),
      POLL_SLACK,
      `how far the countdown admission ${String(index + 1)} re-armed sat from ` +
        `DRIFTER_INTERVAL (${String(DRIFTER_INTERVAL)} s), which is the gap to ` +
        `the next admission and the figure specs/gameplay.md paces the cadence ` +
        `on within ${String(GAP_TOLERANCE)} s`,
    );
  }

  // And the countdown is in seconds: it falls by exactly the game time that
  // passes under it, which is what turns the re-armed figure above into a gap.
  await h.debug.clearDrifters();
  await h.debug.setDrifterIn(DRIFTER_INTERVAL);
  const from = await h.snapshot();
  await h.advance(RUNDOWN_TICKS);
  const to = await h.snapshot();
  assertLessThanOrEqual(
    Math.abs(from.drifterIn - to.drifterIn - (to.simTime - from.simTime)),
    RATE_SLACK,
    `how far the countdown's fall sat from the ${(to.simTime - from.simTime).toFixed(2)} s ` +
      "of simulation that passed under it — specs/state.md counts drifterIn in " +
      "seconds, so the cadence is paced by the clock rather than by frames",
  );
});
