// progression/bonus-life-per-boundary — a gain that carries the score through two
// ten-thousand boundaries pays two lives, not one.
//
// specs/progression.md is explicit that the life is paid PER BOUNDARY and not per
// award: "`lives` rises by one for each boundary the score passes, so a single award
// that carries it over two boundaries earns two lives."
//
// SO THE GAIN HAS TO BE BIGGER THAN `BONUS_LIFE_EVERY`, and only one of the six
// awards specs/scoring.md lists can be made so without ending the run: the time
// bonus, "`SCORE_TIME_BONUS` (`2`) per whole second ... paid `floor(timer)` times
// over". `setTimer(seconds)` "Sets the seconds left on the crossing timer"
// (specs/instrumentation.md) and the specification puts no ceiling on it, so a
// crossing posed with `POSED_TIMER` seconds left pays `2 * POSED_TIMER` on the hop
// that ends it. The victory bonus is the only other award that could be dialled this
// far, and it would end the run and mix `progression/victory-on-level-8`'s rule into
// this reading.
//
// THE ARITHMETIC, AND WHY NO ORDER OF THE AWARDS CHANGES IT. The hop into an open bay
// is paid the row award (`10`), the bay award (`50`) and the time bonus (`10,200`);
// no level is cleared by it, since four bays stay open, so no level or victory award
// is due. From a posed score of `9,900`:
//
//   - the row and bay awards together are `60`, which cannot reach `10,000` from
//     `9,900`, so they cross no boundary whenever they are paid;
//   - the time bonus alone spans `10,200`, so wherever in the order it falls it
//     carries the score from below `10,000` to above `20,000` — through TWO
//     boundaries in one gain;
//   - the hop ends at `20,160`, so exactly two boundaries have been passed however a
//     build divided its awards up, and `lives` must have risen by two.
//
// THE DISTINGUISHING VALUE IS THE SECOND BOUNDARY. A build that pays one life per
// AWARD, or one per crossing however far it jumped, reads one; a build that pays per
// boundary reads two; a build with no bonus life at all reads none. The three models
// read three different numbers.
//
// THE SCORE IS POSED AND THE AWARD IS NOT. `setScore` "grants no bonus life"
// (specs/instrumentation.md, graded by `instrumentation/set-score-grants-no-life`),
// so the pose cannot be what paid either life; that a gain crossing ONE boundary pays
// one life is `progression/bonus-life-at-10000`.
//
// The boundaries actually crossed are read off the score the build produced rather
// than assumed, as the situation the reading was taken in — so a build whose row, bay
// or time award is a different figure fails in the group that owns that figure,
// naming the gain it actually paid, rather than being graded here for a boundary it
// never reached.

import { afterEach, beforeEach, it } from "vitest";
import { BONUS_LIFE_EVERY } from "../../src/constants";
import { assertCloseTo, assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  hop,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";
import { poseAtBayMouth } from "./bay-mouth";

/** The bay the crossing ends in. Four stay open, so no level is cleared by it. */
const BAY = 2;

/**
 * The score the crossing is posed with: a hundred short of the first boundary.
 *
 * More than the `60` the row and bay awards pay together, so neither of those two can
 * cross a boundary on its own whatever order a build pays them in, and the time bonus
 * is the single gain that carries the score across.
 */
const POSED_SCORE = BONUS_LIFE_EVERY - 100;

/**
 * The seconds posed on the crossing timer.
 *
 * `SCORE_TIME_BONUS * 5100` is `10,200`: more than `BONUS_LIFE_EVERY` (`10,000`), so
 * the one award spans two boundaries from `9,900`, and short of `20,000`, so it spans
 * no more than two. `startCrossing` shuts the timer gate, so the whole seconds the
 * award is paid over are the ones posed here rather than ones a drain moved between
 * the pose and the hop.
 */
const POSED_TIMER = 5100;

/** The boundaries that one gain passes, and the lives they are worth. */
const EXPECTED_BOUNDARIES = 2;
const EXPECTED_LIVES = 2;

/**
 * How close the posed timer must read back.
 *
 * A hundredth of a second: nothing drains it with the gate shut, so this is a
 * floating-point tolerance rather than a physical one, and it is far below the one
 * whole second that would change what `floor(timer)` pays.
 */
const TIMER_DIGITS = 2;

/** Frames recorded after the hop, for the replay alone. */
const AFTER_FRAMES = ticksFor(0.25);

/** How many `BONUS_LIFE_EVERY` boundaries a score passed on its way from `from` to `to`. */
function boundariesCrossed(from: number, to: number): number {
  return Math.floor(to / BONUS_LIFE_EVERY) - Math.floor(from / BONUS_LIFE_EVERY);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("pays a life for each of the two boundaries one gain carried the score through", async () => {
  startCrossing(h);
  h.debug.setScore(POSED_SCORE);
  h.debug.setTimer(POSED_TIMER);
  poseAtBayMouth(h, BAY);

  const posed = h.snapshot();
  assertEqual(posed.score, POSED_SCORE, "the score posed short of the boundary");
  assertCloseTo(posed.timer, POSED_TIMER, TIMER_DIGITS, "the posed crossing timer");
  assertEqual(posed.timerRunning, false, "the timer held where it was posed");

  const landed = await captureReplay(h, "bonus", async () => {
    await hop(h, "up");
    const onLanding = h.snapshot();
    await h.advance(AFTER_FRAMES);
    return onLanding;
  });

  // The situation the reading was taken in: the crossing really did end in the bay,
  // and its awards really did carry the score through two boundaries.
  assertEqual(landed.bays[BAY], true, `bay ${BAY} filled by that hop`);
  assertEqual(
    boundariesCrossed(POSED_SCORE, landed.score),
    EXPECTED_BOUNDARIES,
    `two ${BONUS_LIFE_EVERY}-point boundaries passed by that hop's award, which ` +
      `paid ${landed.score - POSED_SCORE}`,
  );

  assertEqual(
    landed.lives - posed.lives,
    EXPECTED_LIVES,
    "one life for each boundary the gain passed (specs/progression.md)",
  );
});
