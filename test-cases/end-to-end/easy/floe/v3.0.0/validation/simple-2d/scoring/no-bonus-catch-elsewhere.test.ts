// scoring/no-bonus-catch-elsewhere — a crossing ended in a bay the bonus catch is
// NOT in pays no catch award.
//
// specs/scoring.md pays `SCORE_BONUS_CATCH` when "a crossing ends in the bay the
// bonus catch is in", and closes the list: "Nothing else scores." So a completing
// hop into another bay, with a catch out in a different one, pays the completing
// hop's own total and not a point more.
//
// THE CATCH IS OUT AND IN A DIFFERENT BAY. That is the whole of what separates
// this point from `bay-award`: a build that pays the catch award whenever a catch
// is anywhere on the strait — or whenever a crossing ends at all — reads 260 here,
// and a build that reads `fishBay` before paying reads 60.
//
// THE TWO BAYS ARE 0 AND 3, three apart and neither adjacent to the other, so the
// reading does not turn on an off-by-one in a build's bay index: bay 0 is the
// leftmost pair of columns and bay 3 the fourth, and no reasonable mis-indexing
// brings them together.
//
// THE TIMER IS POSED EMPTY, so the total this hop owes is `SCORE_ROW + SCORE_BAY`
// (60) exactly and the catch award would stand out as 200 on top of it rather
// than as a fraction of a time bonus.
//
// THE CATCH IS READ BOTH BEFORE AND AFTER. Before, because a build whose
// `setFishBay` did nothing would pay no catch award for the honest reason that
// there was none to collect. After, because specs/bays.md lets a catch leave only
// when it has lingered `FISH_LINGER` (5 s) or "the moment its bay is filled": one
// frame of a hop into another bay is neither, so the catch this check posed is
// still standing in bay 0 when the reading is taken.

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

/** The bay the bonus catch is posed in, and the bay the crossing ends in. */
const CATCH_BAY = 0;
const BAY = 3;

/** The seconds posed on the crossing timer: none, so no time bonus is in the total. */
const TIMER = 0;

/** What that hop pays: its own row and bay awards, and nothing else. */
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

it("pays no catch award for a crossing ended in a bay the catch is not in", async () => {
  startCrossing(h);
  h.debug.setTimer(TIMER);
  h.debug.setFishBay(CATCH_BAY);

  const posed = h.snapshot();
  assertEqual(posed.fishBay, CATCH_BAY, "the bonus catch posed in another bay");
  assertEqual(posed.timer, TIMER, "the crossing timer posed empty");

  const completed = await captureReplay(h, "score", async () => {
    const paid = await completingHop(h, BAY);
    await h.advance(AFTER_FRAMES);
    return paid;
  });

  // The crossing has to have been completed, and the catch has to have still been
  // out when it was: neither its linger nor its own bay's filling has happened.
  assertEqual(completed.landed.bays[BAY], true, `bay ${BAY} filled by the hop`);
  assertEqual(
    completed.landed.fishBay,
    CATCH_BAY,
    `the catch still standing in bay ${CATCH_BAY}`,
  );

  assertEqual(
    completed.paid,
    EXPECTED_AWARD,
    "SCORE_ROW + SCORE_BAY, the completing hop's own total and no catch award",
  );
});
