// hopping/absolute-over-floe — a hop is one ABSOLUTE tile, even mid-drift.
//
// specs/hopping.md (The hop): "The tile the critter is on is `(colAt(x),
// rowAt(y))` for its center `(x, y)`, and a hop's target tile is that tile
// offset by one in the hopped direction. A hop is therefore one absolute tile of
// the strait, whatever the critter is riding and however far a floe has carried
// it between tile columns", and an accepted hop "sets the critter's center to
// the target tile's center exactly, `(tileCX(col), tileCY(row))`, whatever the
// center was before the hop".
//
// So the reading that decides this is the centre after the hop, taken from a
// critter whose centre was NOT on a tile centre when it hopped. The critter is
// posed off-centre with `setCritterX` and set riding a rightward floe, and it
// hops up. Three models of the rule answer differently:
//
//   - one absolute tile      -> x is exactly `tileCX` of the column it was in;
//   - a translation by TILE  -> x keeps the off-centre remainder;
//   - a translation plus the -> x keeps it and gains the drift of the tick.
//     floe's motion
//
// The row it lands on carries a floe of its own, held at a speed of `0`: the
// landing has to be somewhere the critter can stand (a bare water tile drowns
// it, specs/water.md), and a landing lane that was moving would carry the
// critter within the same tick and move the very quantity being read. The lane
// it LEAVES keeps its speed, because "riding a rightward floe" is the case the
// item is about.

import { afterEach, beforeEach, it } from "vitest";
import { START_COL, WATER_BOTTOM, colAt, tileCX, tileCY } from "../constants";
import { assertCloseTo, assertGreaterThan, assertTrue } from "../assert";
import {
  captureReplay,
  createHarness,
  hop,
  poseLane,
  startCrossing,
  type Harness,
} from "../harness";

/** The water row the critter rides, and the water row it hops onto. */
const RIDE_ROW = WATER_BOTTOM;
const LAND_ROW = WATER_BOTTOM - 1;

/** The column the critter rides in, and where each raft's left edge sits. */
const COL = START_COL;
const RAFT_COL = COL - 2;

/**
 * How far the critter's centre is posed from its tile's centre, in stage units.
 * Comfortably inside the half-tile (`16`) that would put it in a neighbouring
 * column, and far enough out that a build translating by `TILE` reads a
 * different number from one snapping to `tileCX`.
 */
const OFFSET = 6;

/** The ridden lane's speed, in tiles per second, and its rightward direction. */
const RIDE_SPEED = 2;
const RIGHTWARD = 1;

/** Frames the ride runs before the hop, so the floe is genuinely carrying it. */
const RIDE_FRAMES = 6;

/** Frames kept after the hop, so the recording ends on where the critter landed. */
const TAIL_FRAMES = 18;

/**
 * Decimal places a position the specification fixes EXACTLY is read to. The
 * rule assigns `tileCX(col)` outright rather than accumulating toward it, so
 * nothing but floating-point representation stands between the two.
 */
const POSITION_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sets the centre to the target tile's centre from a drifting floe", async () => {
  startCrossing(h);
  // The raft the critter rides, and the one it lands on: both cover the column
  // it is in, and the landing one is left at the `0` `poseLane` gives it.
  poseLane(h, RIDE_ROW, "raft4", [RAFT_COL]);
  poseLane(h, LAND_ROW, "raft4", [RAFT_COL]);
  h.debug.setCritterTile(COL, RIDE_ROW);
  h.debug.setCritterX(tileCX(COL) + OFFSET);
  h.debug.setLaneDirection(RIDE_ROW, RIGHTWARD);
  h.debug.setLaneSpeed(RIDE_ROW, RIDE_SPEED);

  const seen = await captureReplay(h, "hop", async () => {
    await h.advance(RIDE_FRAMES);
    const before = h.snapshot().critter;
    const moved = await hop(h, "up");
    const after = h.snapshot().critter;
    // Frames the reading is already taken from, kept so the recording shows the
    // drift, the hop and where it left the critter rather than one still frame.
    await h.advance(TAIL_FRAMES);
    return { before, moved, after };
  });

  assertGreaterThan(
    Math.abs(seen.before.x - tileCX(colAt(seen.before.x))),
    1,
    "the critter riding off its tile's centre before the hop",
  );
  assertTrue(seen.moved, "the hop up from the floe to be accepted");
  assertCloseTo(
    seen.after.x,
    tileCX(colAt(seen.before.x)),
    POSITION_DIGITS,
    "the centre x after a hop taken mid-drift",
  );
  assertCloseTo(
    seen.after.y,
    tileCY(LAND_ROW),
    POSITION_DIGITS,
    "the centre y after a hop taken mid-drift",
  );
});
