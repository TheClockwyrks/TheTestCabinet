// movement/thrust-lifts — the jetpack lifts the miner.
//
// `specs/character.md`: "Holding thrust fires the jetpack. While it is held: the
// net vertical acceleration is `climbAccel` upward, where
// `climbAccel = emptyAccel * max(0, 1 - load)` ... Gravity contributes nothing
// further while thrust is held." At tier `1` with an empty bay,
// `specs/upgrades.md` gives `emptyAccel` as `1200` units per second squared, so
// half a second of held thrust from rest lifts the miner about `150` units — near
// two tiles — and it keeps rising while the key is down.
//
// This is the whole of how a prospector gets home: "the only way to ascend is the
// jetpack through tunnels already carved". A build whose thrust does not lift is
// a build with no way out of the mine, which is why the point fails it outright.
//
// WHAT IS READ, AND WHAT IS NOT. That the miner leaves the ground and travels
// upward through the shaft it is standing in. How fast it may climb, how the load
// scales the climb, and what the burn costs are separate figures with separate
// points; the bound here is one tile of rise over half a second, which the stated
// acceleration clears comfortably even allowing a build a few frames to spool up.
//
// The bay is empty, so `load` is `0` and `climbAccel` is the tier's own; the
// drill is gated, so the key that is down is the only thing acting.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan } from "../assert";
import { TILE } from "../constants";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  digShaft,
  driveHold,
  openScene,
  pinDrill,
  standOn,
  TICK_HZ,
  type Harness,
} from "../harness";

const COL = 8;
const TOP_ROW = 6;
const FLOOR_ROW = 31;

/** Half a second of held thrust. */
const CLIMB_FRAMES = TICK_HZ / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries the miner up the shaft while thrust is held", async () => {
  await openScene(h);
  await digShaft(h, COL, TOP_ROW, FLOOR_ROW - 1);
  await standOn(h, COL, FLOOR_ROW);
  await pinDrill(h);
  await h.advance(2);
  assertEqual(
    (await h.snapshot()).miner.grounded,
    true,
    "the miner standing on the shaft's floor before the climb",
  );

  const climb = await captureReplay(h, "climb", () =>
    driveHold(h, ACTION_KEY.up, CLIMB_FRAMES),
  );

  // Upward is negative `y`: the miner left the floor and is travelling up.
  assertLessThan(climb.dy, -TILE, "the rise over half a second of held thrust");
  assertLessThan(climb.snapshot.miner.vy, 0, "the vertical speed under thrust");
  assertEqual(
    climb.snapshot.miner.grounded,
    false,
    "the miner off the ground under thrust",
  );
});
