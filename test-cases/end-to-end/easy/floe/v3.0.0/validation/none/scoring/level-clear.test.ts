// scoring/level-clear — the hop that fills a level's LAST open bay pays a hundred
// points for every level cleared, on top of what that hop pays as a crossing.
//
// `specs/scoring.md`: "A cleared level | `SCORE_LEVEL` (`100`) times the level |
// The level's last open bay is filled", and "filling the level's last bay pays
// `SCORE_LEVEL * level` on top again".
//
// IT IS READ AS A DIFFERENCE BETWEEN TWO HOPS INTO THE SAME BAY, at the same
// level, with the same posed timer, differing only in whether the other four bays
// are already filled. The completing hop's own total is in both readings and
// cancels, so what the pair measures is the level award alone and this point
// cannot fail for a wrong `SCORE_BAY` or `SCORE_ROW`.
//
// LEVEL 3 IS THE DISTINGUISHING VALUE: the award must be 300, so a build paying a
// flat `SCORE_LEVEL` reads 100, one paying per FILLED BAY reads 500, one paying
// per level ALREADY cleared reads 200, and one paying nothing reads 0. Level 3 is
// also below `TOTAL_LEVELS`, so the run does not end here and no victory award is
// due — that is `victory-bonus`'s reading, and it would otherwise be mixed into
// this one.
//
// THE FOUR OTHER BAYS ARE POSED FILLED AND THE FIFTH IS HOPPED INTO, because
// `specs/bays.md` clears a level on the HOP that fills its last open bay and on
// no other event: posing all five would clear nothing (`bays/posed-full-does-not-clear`).
// The open one is bay 2, the middle of the five, so a build that only notices its
// first or its last bay leaves the level running and reads the control's number
// here rather than the cleared one.
//
// THE TIMER IS POSED EMPTY in both halves, so no time bonus is in either reading
// and nothing about the difference depends on the clock.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { BAY_COUNT, SCORE_LEVEL } from "../constants";
import {
  captureReplay,
  createHarness,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";
import { completingHop } from "./crossing";

/** The level both crossings are taken at: below `TOTAL_LEVELS`, so it clears rather than wins. */
const LEVEL = 3;

/** The bay both hops end in — the middle one, left open in the cleared half. */
const BAY = 2;

/** The seconds posed on the crossing timer: none, in both halves. */
const TIMER = 0;

/** What the clearing hop pays over the same hop that clears nothing. */
const EXPECTED_EXTRA = SCORE_LEVEL * LEVEL;

/** Every bay filled, which is what the clearing hop leaves behind. */
const ALL_FILLED: boolean[] = Array.from({ length: BAY_COUNT }, () => true);

/** Ticks recorded after the clearing hop, for the replay alone. */
const AFTER_TICKS = ticksFor(0.25);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("pays a hundred a level when the last open bay is filled", async () => {
  // The control: the same hop into the same bay with the other four still open,
  // so it ends a crossing and clears nothing.
  await startCrossing(harness, LEVEL);
  await harness.debug.setTimer(TIMER);
  const plain = await completingHop(harness, BAY);
  assertEqual(plain.landed.bays[BAY], true, `bay ${BAY} filled, level running`);

  // The measurement: a fresh level-3 strait with the other four bays posed
  // filled, so the same hop is the one that fills the last open bay.
  await startCrossing(harness, LEVEL);
  await harness.debug.setTimer(TIMER);
  for (let bay = 0; bay < BAY_COUNT; bay += 1) {
    if (bay !== BAY) await harness.debug.setBay(bay, true);
  }

  const posed = await harness.snapshot();
  assertEqual(posed.level, LEVEL, "the level the clear is taken at");
  assertEqual(posed.score, 0, "a fresh run's score");

  const cleared = await captureReplay(harness, "score", async () => {
    const hop = await completingHop(harness, BAY);
    await harness.advance(AFTER_TICKS);
    return hop;
  });

  // The last open bay has to have been filled by that hop for the award to be
  // about anything; whether the clear also holds the strait is `bays`' point.
  assertDeepEqual(
    cleared.landed.bays,
    ALL_FILLED,
    "every bay filled by that hop",
  );

  assertEqual(
    cleared.paid - plain.paid,
    EXPECTED_EXTRA,
    `SCORE_LEVEL * ${LEVEL} over the same hop that cleared nothing`,
  );
});
