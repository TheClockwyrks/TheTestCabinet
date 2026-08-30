// movement/facing-follows-input — the miner faces the way it last moved.
//
// `specs/character.md`: "The miner also faces `east` or `west`, following the last
// lateral input, and its sprite mirrors to match." `specs/controls.md` states the
// same from the controls' side: "The miner faces the direction of the last `left`
// or `right` held, and its sprite mirrors to match."
//
// Two properties, and both are read here because they are one rule: the facing
// FOLLOWS the input, so left leaves it `west` and right leaves it `east`; and it
// HOLDS, so releasing the key leaves the miner facing the way it was going rather
// than snapping back to a default. A build that resets the facing on release
// leaves a standing prospector that flips east every time the player stops, which
// is what the second half of each sentence forbids.
//
// The order runs west first and then east, from a miner posed facing east, so
// neither reading can be satisfied by a facing that never changed.
//
// The drill is gated: a walk into a minable cell is a cut, and the corridor is
// plain rock floor with open space either side, so the walk itself is unobstructed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  driveHold,
  layFloor,
  openScene,
  pinDrill,
  standOn,
  TICK_HZ,
  type Harness,
} from "../harness";

const COL = 12;
const ROW = 12;

/** A quarter second of held walk, and a half second standing after the release. */
const WALK_FRAMES = TICK_HZ / 4;
const SETTLE_FRAMES = TICK_HZ / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("faces west after left and east after right, and holds it on release", async () => {
  openScene(h);
  layFloor(h, ROW);
  standOn(h, COL, ROW, "east");
  pinDrill(h);

  const turned = await captureReplay(h, "facing", async () => {
    const west = await driveHold(h, ACTION_KEY.left, WALK_FRAMES);
    await h.advance(SETTLE_FRAMES);
    const heldWest = h.snapshot();

    const east = await driveHold(h, ACTION_KEY.right, WALK_FRAMES);
    await h.advance(SETTLE_FRAMES);
    const heldEast = h.snapshot();

    return { west, heldWest, east, heldEast };
  });

  assertEqual(
    turned.west.snapshot.miner.facing,
    "west",
    "the facing while left is held",
  );
  assertEqual(
    turned.heldWest.miner.facing,
    "west",
    "the facing after left is released",
  );
  assertEqual(
    turned.east.snapshot.miner.facing,
    "east",
    "the facing while right is held",
  );
  assertEqual(
    turned.heldEast.miner.facing,
    "east",
    "the facing after right is released",
  );
});
