// scoring/last-hop-total — the hop that completes a crossing pays all three of
// its awards together, and pays them once.
//
// specs/scoring.md: "A hop that ends a crossing pays the row award, the bay
// award, and the time bonus together, so a crossing completed with `T` whole
// seconds left on the timer pays `10 + 50 + 2 * T` for that hop."
//
// THIS IS THE WORKED TOTAL, read as ONE number off ONE hop. The three parts are
// decided separately by `row-advance`, `bay-award` and `time-bonus`; what is left
// for this point is that a build which has all three figures right still adds
// them up on the same hop — a build that pays the bay on the hop and the time
// bonus a frame later, or pays the row award only when the row is not a bay,
// reads a total this one does not.
//
// T IS 12, POSED, so the total is `10 + 50 + 2 * 12` (84). Twelve is chosen
// because the three parts stay far apart in it: 10, 50 and 24 are pairwise
// distinct, no two of them sum to the third, and no two of them are equal — so
// every award a build drops, doubles or pays twice reads a different number. A
// build that drops the row award reads 74, the bay award 34, the time bonus 60,
// and one that pays the crossing twice reads 168.
//
// THE TIMER IS POSED, NEVER RUN. `startCrossing` shuts the timer gate, so the
// whole-second count is the one this check chose rather than one the drain moved
// between the pose and the hop. Four bays are left open and no bonus catch is
// out, so the level award, the catch award and the victory award are all not due:
// this is the completing hop's own total and nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SCORE_BAY, SCORE_ROW, SCORE_TIME_BONUS } from "../constants";
import {
  captureReplay,
  createHarness,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";
import { completingHop } from "./crossing";

/** The bay the crossing ends in. */
const BAY = 3;

/** The seconds posed on the crossing timer, all of them whole. */
const TIMER = 12;

/** The worked total specs/scoring.md states for a completing hop: 10 + 50 + 2 * 12. */
const EXPECTED_AWARD =
  SCORE_ROW + SCORE_BAY + SCORE_TIME_BONUS * Math.floor(TIMER);

/** Frames recorded after the hop, for the replay alone. Every reading precedes them. */
const AFTER_FRAMES = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("pays eighty-four for a crossing completed with twelve seconds left", async () => {
  startCrossing(h);
  h.debug.setTimer(TIMER);

  const posed = h.snapshot();
  assertEqual(posed.timer, TIMER, "the crossing timer posed at twelve");
  assertEqual(posed.timerRunning, false, "the timer held there");

  const completed = await captureReplay(h, "score", async () => {
    const paid = await completingHop(h, BAY);
    await h.advance(AFTER_FRAMES);
    return paid;
  });

  // The crossing has to have been completed for the total to be about anything.
  assertEqual(completed.landed.bays[BAY], true, `bay ${BAY} filled by the hop`);

  assertEqual(
    completed.paid,
    EXPECTED_AWARD,
    "SCORE_ROW + SCORE_BAY + SCORE_TIME_BONUS * 12, all on the one hop",
  );
});
