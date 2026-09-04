// bays/fish-cleared-on-level — a new level opens with no bonus catch out.
//
// `specs/bays.md` opens a level with five open bays and no bonus catch on the
// strait, and `specs/progression.md` opens the next level after the
// `CLEAR_PAUSE` hold the clearing hop starts. So a catch that was out when the
// level cleared is gone by the time the next crossing begins: a player who
// arrives on a fresh level and finds the previous level's catch still sitting in
// a bay is looking at state the specification says a level does not carry over.
//
// THE CATCH IS IN A BAY THE HOP DOES NOT FILL, which is the whole of what makes
// this a point of its own. A catch in the bay being filled is taken off BY THE
// FILL, and that is `bays/fish-cleared-when-bay-filled`; posing it there would
// grade that rule again and say nothing about the level advance. Here the fill
// cannot touch it, so the only thing that can have cleared it is the new level.
//
// THE CADENCE STAYS OFF, as `startCrossing` leaves it. With it off no linger can
// run out and no next catch can arrive, so a build whose catch merely happened
// to leave on time cannot pass — and a build that opened the level correctly
// cannot be failed by a fresh catch arriving inside the hold.
//
// FOUR BAYS ARE POSED FILLED and the fifth is filled by a real hop, because
// `specs/bays.md` clears a level on the HOP that fills its last open bay and no
// pose clears one (`bays/posed-full-does-not-clear`). That the hop clears the
// level at all is `bays/all-five-clears`; it is read here only as the situation.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { BAY_COUNT, CLEAR_PAUSE } from "../constants";
import {
  captureReplay,
  createHarness,
  hop,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";
import { poseAtBayMouth } from "./bay-mouth";

/** The one bay left open for the hop, and the bay the catch sits in. */
const OPEN_BAY = 2;
const FISH_BAY = 4;

/** The level the clear is taken on: below `TOTAL_LEVELS`, so it holds rather than wins. */
const LEVEL = 1;

/**
 * How far past `CLEAR_PAUSE` the reading is taken, in seconds.
 *
 * A tenth of a second, so a build whose hold runs a shade long is graded on its
 * length by `progression/level-advances` rather than failed here.
 */
const TOLERANCE = 0.1;

/** Whole ticks that carry the clearing hold out, so the next level opens. */
const CLEAR_TICKS = ticksFor(CLEAR_PAUSE + TOLERANCE);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the next level with no bonus catch on the strait", async () => {
  await startCrossing(h, LEVEL);
  for (let bay = 0; bay < BAY_COUNT; bay += 1) {
    if (bay !== OPEN_BAY) await h.debug.setBay(bay, true);
  }
  await h.debug.setFishBay(FISH_BAY);
  await poseAtBayMouth(h, OPEN_BAY);

  const posed = await h.snapshot();
  assertEqual(posed.fishCadence, false, "the bonus catch's own cadence off");
  assertEqual(
    posed.fishBay,
    FISH_BAY,
    `the bonus catch in bay ${FISH_BAY}, which the hop into bay ${OPEN_BAY} ` +
      "does not fill",
  );

  const opened = await captureReplay(h, "reset", async () => {
    await hop(h, "up");
    const cleared = await h.snapshot();
    assertEqual(cleared.phase, "clearing", "the level cleared by that hop");
    assertEqual(
      cleared.fishBay,
      FISH_BAY,
      `the catch still in bay ${FISH_BAY} on the clearing hop, so what takes ` +
        "it off is the level that follows",
    );
    await h.advance(CLEAR_TICKS);
    return h.snapshot();
  });

  assertEqual(
    opened.level,
    LEVEL + 1,
    `level ${LEVEL + 1} open once the clearing hold ran out ` +
      "(specs/progression.md)",
  );
  assertNull(
    opened.fishBay,
    "the bonus catch, on a level that has just opened — a level opens with no " +
      "bonus catch on the strait (specs/bays.md)",
  );
});
