// scoring/bonus-catch — a crossing that ends in the bay holding the bonus catch
// pays two hundred more than the same crossing into an empty bay.
//
// `specs/scoring.md`: "The bonus catch | `SCORE_BONUS_CATCH` (`200`) | A crossing
// ends in the bay the bonus catch is in", and "Ending the crossing in the bay
// holding the bonus catch pays `SCORE_BONUS_CATCH` on top of that."
// `specs/bays.md` fixes what the catch is worth to nothing else: "It changes
// nothing about whether its bay may be entered."
//
// IT IS READ AS A DIFFERENCE BETWEEN TWO HOPS INTO THE SAME BAY, at the same
// level, with the same posed timer, differing only in whether the bonus catch is
// in that bay. The completing hop's own total is in both readings and cancels, so
// what the pair measures is the catch award alone and this point cannot fail for
// a wrong `SCORE_BAY`, `SCORE_ROW` or time bonus.
//
// THE CATCH IS POSED, NOT WAITED FOR. `startCrossing` shuts the cadence gate, so
// the only bonus catch on the strait is the one this check put there, in the bay
// it chose — a catch arriving on its own eight-second cadence into either half
// would add 200 to a reading that never asked for it.
//
// THE POSE IS READ BACK BEFORE THE HOP. A build whose `setFishBay` did nothing
// would pay no bonus for the honest reason that there was no catch to collect,
// and would otherwise pass this point while failing the requirement.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { SCORE_BONUS_CATCH } from "../constants";
import {
  captureReplay,
  createHarness,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";
import { completingHop } from "./crossing";

/** The bay both crossings end in, and the bay the catch is posed into. */
const BAY = 3;

/** The seconds posed on the crossing timer: none, in both halves. */
const TIMER = 0;

/** What the hop into the catch's bay pays over the same hop into an empty one. */
const EXPECTED_EXTRA = SCORE_BONUS_CATCH;

/** Ticks recorded after the measured hop, for the replay alone. */
const AFTER_TICKS = ticksFor(0.25);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("pays two hundred more for a crossing ended in the bonus catch's bay", async () => {
  // The control: the same hop into the same bay with no catch anywhere.
  await startCrossing(harness);
  await harness.debug.setTimer(TIMER);
  const empty = await harness.snapshot();
  assertNull(empty.fishBay, "no bonus catch out for the control hop");

  const plain = await completingHop(harness, BAY);
  assertEqual(
    plain.landed.bays[BAY],
    true,
    `bay ${BAY} filled, no catch in it`,
  );

  // The measurement: a fresh crossing, everything as before, the catch posed in
  // the bay the hop ends in.
  await startCrossing(harness);
  await harness.debug.setTimer(TIMER);
  await harness.debug.setFishBay(BAY);

  const posed = await harness.snapshot();
  assertEqual(
    posed.fishBay,
    BAY,
    "the bonus catch posed in the bay hopped into",
  );
  assertEqual(posed.fishCadence, false, "no second catch arriving on its own");

  const caught = await captureReplay(harness, "score", async () => {
    const hop = await completingHop(harness, BAY);
    await harness.advance(AFTER_TICKS);
    return hop;
  });

  assertEqual(caught.landed.bays[BAY], true, `bay ${BAY} filled, catch in it`);

  assertEqual(
    caught.paid - plain.paid,
    EXPECTED_EXTRA,
    "SCORE_BONUS_CATCH over the same hop into a bay with no catch in it",
  );
});
