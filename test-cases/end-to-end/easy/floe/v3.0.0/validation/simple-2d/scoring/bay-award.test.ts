// scoring/bay-award — the hop that ends a crossing in an open bay pays the bay
// award.
//
// specs/scoring.md: "A filled bay | `SCORE_BAY` (`50`) | A crossing ends in an
// open bay", and "A hop that ends a crossing pays the row award, the bay award,
// and the time bonus together, so a crossing completed with `T` whole seconds
// left on the timer pays `10 + 50 + 2 * T` for that hop."
//
// THE TIMER IS POSED AT 0, with the timer gate `startCrossing` shuts holding it
// there, so `T` is `0` and the time bonus is worth nothing: what the hop pays is
// `SCORE_ROW + SCORE_BAY` (60), and the bay's own award is the 50 of it that
// `row-advance` has already accounted for separately. Posing the timer rather
// than letting it drain is what makes `T` the figure this check chose rather than
// one the drain moved between the pose and the hop.
//
// NOTHING ELSE THE SPECIFICATION PAYS FOR IS IN THE SCENE. Four bays are left
// open, so the level does not clear and no level award is due; no bonus catch is
// out, so no catch award is due; the run is at level 1, so no victory is due.
// Every one of those wrong models reads a different number: 360 for a level
// award, 260 for a catch, and 60 is the only reading a build that pays the bay
// award alone can produce.
//
// THE BAY IS BAY 3 — neither the first, nor the middle, nor an edge of the
// strait — so a build that pays for the wrong bay still pays here, and a build
// that pays only for one particular bay does not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SCORE_BAY, SCORE_ROW } from "../../src/constants";
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

/** The seconds posed on the crossing timer: none, so the time bonus is worth nothing. */
const TIMER = 0;

/** What that hop pays: the row it reached and the bay it filled. */
const EXPECTED_AWARD = SCORE_ROW + SCORE_BAY;

/** Frames recorded after the hop, for the replay alone. Every reading precedes them. */
const AFTER_FRAMES = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("pays sixty for a completing hop with no time left on the clock", async () => {
  startCrossing(h);
  h.debug.setTimer(TIMER);

  const posed = h.snapshot();
  assertEqual(posed.timer, TIMER, "the crossing timer posed empty");
  assertEqual(posed.timerRunning, false, "the timer held there");

  const completed = await captureReplay(h, "score", async () => {
    const paid = await completingHop(h, BAY);
    await h.advance(AFTER_FRAMES);
    return paid;
  });

  // The bay has to have been filled for an award to be about anything: a refused
  // hop pays nothing for a reason this point is not about.
  assertEqual(completed.landed.bays[BAY], true, `bay ${BAY} filled by the hop`);

  assertEqual(
    completed.paid,
    EXPECTED_AWARD,
    "SCORE_ROW + SCORE_BAY, the whole of a completing hop with T = 0",
  );
});
