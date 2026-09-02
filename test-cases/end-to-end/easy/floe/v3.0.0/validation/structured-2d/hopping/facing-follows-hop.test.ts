// hopping/facing-follows-hop — the critter faces the way it last hopped.
//
// specs/hopping.md (The hop): an accepted hop "sets the critter's facing to the
// direction hopped". So after four accepted hops, one in each grid direction,
// the facing reported after each is the direction of that hop and no other.
//
// The four are taken in turn from one posed critter, with the hop cooldown posed
// back to `0` before each so that every press is a hop rather than one the
// previous hop's cooldown swallowed. Posing it, rather than waiting it out,
// keeps this reading about the facing alone: the cadence is a rule of its own,
// decided by its own items, and a build that mishandles it should not fail here
// as well. Each hop is asserted to have MOVED, because a refused hop leaves the
// facing as it was and a reading taken after one would say nothing about this
// rule.
//
// The critter is posed facing `right` before the sequence, and the sequence
// begins with `up`. Every reading therefore differs from the one before it —
// posed `right`, then `up`, `down`, `left`, `right` — so a build that never
// updates the facing, and a build that updates it one hop late, each fail at the
// first reading rather than passing three of four by coincidence.
//
// The route stays between the near shore and the ice row above it, both solid
// across their whole width (specs/strait.md) on a strait `startCrossing` leaves
// empty, so all four hops are accepted and nothing but the hop decides the
// facing.

import { afterEach, beforeEach, it } from "vitest";
import { ROW_NEAR, START_COL } from "../constants";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  hop,
  startCrossing,
  type Facing,
  type Harness,
} from "../harness";

/** The facing posed before the sequence, which none of the first hops is. */
const POSED_FACING: Facing = "right";

/** Frames each facing is held for the recording, after its reading is taken. */
const SHOW_FRAMES = 18;

/** The four hops, in the order the item takes them. */
const SEQUENCE: readonly Facing[] = ["up", "down", "left", "right"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports the facing of each hop it takes", async () => {
  startCrossing(h);
  h.debug.setCritterTile(START_COL, ROW_NEAR);
  h.debug.setCritterFacing(POSED_FACING);

  const seen = await captureReplay(h, "facing", async () => {
    const readings: { direction: Facing; moved: boolean; facing: Facing }[] =
      [];
    for (const direction of SEQUENCE) {
      h.debug.setHopCooldown(0);
      const moved = await hop(h, direction);
      readings.push({ direction, moved, facing: h.snapshot().critter.facing });
      // The reading is already taken; these frames are for the recording, so a
      // reviewer sees each facing held rather than four frames in a row.
      await h.advance(SHOW_FRAMES);
    }
    return readings;
  });

  for (const reading of seen) {
    assertEqual(
      reading.moved,
      true,
      `the hop ${reading.direction} to be accepted`,
    );
    assertEqual(
      reading.facing,
      reading.direction,
      `the facing after hopping ${reading.direction}`,
    );
  }
});
