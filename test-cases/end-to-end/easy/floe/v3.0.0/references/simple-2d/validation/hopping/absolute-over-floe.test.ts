// hopping/absolute-over-floe — a hop taken from a drifting floe is one ABSOLUTE
// tile of the strait, landing exactly on the target tile's centre.
//
// specs/hopping.md: "A hop is therefore one absolute tile of the strait, whatever
// the critter is riding and however far a floe has carried it between tile
// columns", and an accepted hop "sets the critter's center to the target tile's
// center exactly, `(tileCX(col), tileCY(row))`, whatever the center was before the
// hop". The target tile is the critter's own tile — `(colAt(x), rowAt(y))` for its
// centre — offset by one in the hopped direction.
//
// The distinguishing pose is a centre that is NOT on a tile centre. Three models
// agree on every hop taken from a settled critter and disagree here:
//
//   * the specification's — the centre is SET to `(tileCX(col), tileCY(row))`,
//     which snaps the drift out;
//   * translating by `TILE` — the centre keeps its offset and the critter is left
//     between columns for the rest of the crossing;
//   * adding the lane's motion to the landing — the centre is a tick of carry past
//     the tile centre.
//
// So the assertion is the exact centre, to float noise, and each wrong model reads
// as a different number: the first as the tile centre, the second as the centre
// less the drift, the third as the centre plus one tick of the lane's carry.
//
// THE WORLD IS THE HOP AND NOTHING ELSE. The strait is emptied, then exactly two
// floes are posed: the one the critter rides, on a rightward lane running at the
// speed specs/water.md gives that row, and the one it lands on, on a lane held at
// `0`. The landing floe is not a bystander — the row above a water row is water
// (specs/strait.md), so without it the tick that takes this hop would also drown
// the critter and there would be no landing to read.
//
// THE TARGET IS DERIVED FROM THE CRITTER'S OWN PRE-HOP TILE rather than from the
// column it was posed in, because the column a hop reads is the one the critter's
// centre is in when the hop is taken, and the carry has been running. The pose is
// checked to sit clear of both of its column's boundaries by more than the hop
// tick's own carry, so the tile the hop reads cannot be in doubt.

import { afterEach, beforeEach, it } from "vitest";
import {
  laneSpeed,
  TICK_HZ,
  TILE,
  tileCX,
  tileCY,
  tileLeft,
  WATER_TOP,
} from "../constants";
import {
  assertBetween,
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
} from "../assert";
import {
  captureReplay,
  createHarness,
  holdFor,
  keyFor,
  poseLane,
  startCrossing,
  type Harness,
} from "../harness";

/** The water row the critter rides, one above the top of the band so it can hop up. */
const RIDE_ROW = WATER_TOP + 1;

/** The water row the hop lands on. */
const LAND_ROW = RIDE_ROW - 1;

/** The column the critter is posed in. */
const RIDE_COL = 20;

/** Where each raft's left edge sits: a four-tile raft here spans columns 19 to 22. */
const RAFT_COL = RIDE_COL - 1;

/**
 * How far into its column the critter's centre is posed, in stage units.
 *
 * An eighth of a tile past the column's left boundary, and so twelve units short
 * of its centre: the drift below carries it further into the column without
 * reaching either boundary, and the pose is unmistakably off-centre.
 */
const OFFSET_IN_TILE = 4;

/** The lane's own level-1 speed, in tiles per second (specs/water.md). */
const DRIFT_SPEED = laneSpeed(RIDE_ROW, 1);

/** How far one tick of that lane carries a rider, in stage units. */
const CARRY_PER_TICK = (DRIFT_SPEED * TILE) / TICK_HZ;

/** Ticks of drift before the hop, so the floe under the critter is genuinely running. */
const DRIFT_TICKS = 6;

/**
 * How clear of either column boundary the pre-hop centre must sit, in stage units:
 * twice one tick of carry, so the tick that takes the hop cannot move the centre
 * into a neighbouring column and change which tile the hop reads.
 */
const BOUNDARY_MARGIN = 2 * CARRY_PER_TICK;

/** How far off its column's centre the pre-hop centre must sit for the pose to bite. */
const OFF_CENTRE_MIN = 1;

/** The centre of a tile is exact (specs/hopping.md), so the tolerance is float noise. */
const CENTRE_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sets the critter's centre exactly on the tile one row up", async () => {
  startCrossing(h);

  // The landing, held still: the row above a water row is water, so the hop needs
  // a floe to arrive on or the same tick drowns the critter.
  poseLane(h, LAND_ROW, "raft4", [RAFT_COL]);

  // The ride, released rightward at the speed specs/water.md gives the row.
  poseLane(h, RIDE_ROW, "raft4", [RAFT_COL]);
  h.debug.setLaneDirection(RIDE_ROW, 1);
  h.debug.setLaneSpeed(RIDE_ROW, DRIFT_SPEED);

  h.debug.setCritterTile(RIDE_COL, RIDE_ROW);
  h.debug.setCritterX(tileLeft(RIDE_COL) + OFFSET_IN_TILE);

  const ride = await captureReplay(h, "hop", async () => {
    await h.advance(DRIFT_TICKS);
    const before = h.snapshot().critter;
    await holdFor(h, keyFor("up"), 1);
    return { before, after: h.snapshot().critter };
  });

  // The pose, not the build: the hop is taken from a centre that is off its tile's
  // centre and clear of both of its column's boundaries.
  const { before, after } = ride;
  assertEqual(before.row, RIDE_ROW, "the row the hop is taken from");
  assertBetween(
    before.x - tileLeft(before.col),
    BOUNDARY_MARGIN,
    TILE - BOUNDARY_MARGIN,
    "how far into its column the pre-hop centre sits",
  );
  assertGreaterThan(
    Math.abs(before.x - tileCX(before.col)),
    OFF_CENTRE_MIN,
    "how far off its column's centre the pre-hop centre sits",
  );

  assertEqual(after.col, before.col, "the column the hop landed in");
  assertEqual(after.row, LAND_ROW, "the row the hop landed on");
  assertCloseTo(
    after.x,
    tileCX(before.col),
    CENTRE_DIGITS,
    "centre x, which is the target tile's centre exactly",
  );
  assertCloseTo(
    after.y,
    tileCY(LAND_ROW),
    CENTRE_DIGITS,
    "centre y, which is the target tile's centre exactly",
  );
});
