// scoring/row-advance — a hop onto a row above every row this crossing has
// reached pays `SCORE_ROW`, and pays nothing else.
//
// `specs/scoring.md`: "A newly reached row | `SCORE_ROW` (`10`) | An accepted hop
// takes the critter to a row above every row it has reached this crossing, which
// is any hop that moves `bestRow` closer to the far shore." `specs/hopping.md`
// fixes `bestRow` as "the topmost row the critter has stood on this crossing",
// `ROW_NEAR` (`19`) when a crossing begins.
//
// THE HOP IS THE FIRST ONE OF A FRESH CROSSING, from the near shore into the ice
// band, which is the plainest hop the game has that moves `bestRow`: one row, no
// bay, no crossing ended, nothing else the specification pays for. What it pays
// is therefore `SCORE_ROW` and nothing at all beside it.
//
// THE CROSSING TIMER IS LEFT WHERE A FRESH CROSSING PUTS IT — 30 s at level 1,
// held there by the timer gate `startCrossing` shuts. That is the distinguishing
// value: `specs/scoring.md` pays the time bonus for "a crossing [that] ends in an
// open bay" and this hop ends nothing, so a build that pays `SCORE_TIME_BONUS`
// per whole second on every scoring hop reads 70 here rather than 10, and a build
// that pays the bay award too reads 120. Posing the timer to 0 would have hidden
// both.
//
// The row hopped ONTO is read as well, because an award for a row the critter
// never reached would be the same 10 as an award for one it did.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  HOP_KEY,
  ICE_BOTTOM,
  ROW_NEAR,
  SCORE_ROW,
  START_COL,
} from "../constants";
import {
  captureReplay,
  createHarness,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The row the critter starts the crossing on, and the row it hops onto. */
const FROM_ROW = ROW_NEAR;
const TO_ROW = ICE_BOTTOM;

/** What that hop pays: one newly reached row, and nothing else. */
const EXPECTED_AWARD = SCORE_ROW;

/** Ticks recorded after the hop, for the replay alone. Every reading precedes them. */
const AFTER_TICKS = ticksFor(0.25);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("pays ten for the row a hop newly reaches, and nothing else", async () => {
  await startCrossing(harness);

  const posed = await harness.snapshot();
  assertEqual(posed.critter.row, FROM_ROW, "the critter on the near shore");
  assertEqual(posed.critter.bestRow, FROM_ROW, "a fresh crossing's bestRow");
  assertEqual(posed.score, 0, "a fresh run's score");

  const advanced = await captureReplay(harness, "score", async () => {
    await harness.tap(HOP_KEY.up);
    const landed = await harness.snapshot();
    await harness.advance(AFTER_TICKS);
    return landed;
  });

  // The hop has to have been taken for the award to be about anything: a build
  // that refused it would otherwise fail below for paying nothing.
  assertEqual(advanced.critter.row, TO_ROW, "the row the hop landed on");
  assertEqual(advanced.critter.col, START_COL, "the column it hopped from");

  assertEqual(
    advanced.score - posed.score,
    EXPECTED_AWARD,
    "SCORE_ROW alone, for one newly reached row",
  );
});
