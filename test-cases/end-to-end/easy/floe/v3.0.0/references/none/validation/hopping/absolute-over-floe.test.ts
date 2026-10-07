// hopping/absolute-over-floe — a hop is one ABSOLUTE tile, even while riding.
//
// `specs/hopping.md` fixes the target and the landing separately, and this decides
// both at once. The tile the critter is on is `(colAt(x), rowAt(y))` for its
// center, a hop's target is "that tile offset by one in the hopped direction",
// and "a hop is therefore one absolute tile of the strait, whatever the critter is
// riding and however far a floe has carried it between tile columns"; an accepted
// hop then "sets the critter's center to the target tile's center exactly,
// `(tileCX(col), tileCY(row))`, whatever the center was before the hop".
// `specs/water.md` says the same from its side: "a hop taken while riding is one
// absolute tile of the strait".
//
// THE POSE IS WHAT MAKES EVERY WRONG MODEL READ AS A DIFFERENT NUMBER. The critter
// is put on a drifting floe with its center deliberately NOT at a tile center —
// one unit inside the column's left edge, then carried a few ticks toward the
// middle — and the hop is taken from there:
//
//   - a build that SNAPS to the target center lands on `tileCX(20)` (`656`);
//   - a build that TRANSLATES BY `TILE` lands about eleven units short of it,
//     left between columns, which is what the floe-carry rule and the footing
//     derivation would then read wrongly for the rest of the crossing;
//   - a build that adds the floe's motion to the landing lands past it.
//
// The column reading alone would separate none of these, which is why the CENTER
// is what is asserted.
//
// THE TOLERANCE IS ONE TICK OF THE LANE'S OWN TRAVEL. `specs/hopping.md` fixes the
// landing exactly but no file fixes where inside a tick the carry falls relative
// to the hop, so a build that carries the critter before it hops and one that
// carries it after differ by exactly the lane's travel over one tick, and both
// play identically. Nothing else is allowed: eleven units of translation is more
// than ten times that.
//
// THE ROW HOPPED ONTO CARRIES A FLOE OF ITS OWN, HELD STILL. Deep water with no
// floe over the center costs a life on the tick it is stood on (`specs/water.md`),
// so a hop up into open water would grade the drowning rule instead of this one;
// and holding that lane at rest keeps the landing center a fact about the hop
// rather than about the second lane. The critter is posed well inside its column
// so that one tick of drift either way cannot change which column the hop is
// taken from.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertGreaterThan } from "../assert";
import {
  HOP_KEY,
  TILE,
  laneSpeed,
  tileCX,
  tileCY,
  tileLeft,
} from "../constants";
import {
  captureReplay,
  createHarness,
  poseLane,
  startCrossing,
  type Harness,
} from "../harness";

/** The water row the critter rides, and the water row one hop up from it. */
const RIDE_ROW = 7;
const TARGET_ROW = 6;

/** The column the hop is taken from and must land in. */
const COL = 20;

/** The lane's speed at level 1, in tiles per second (`specs/water.md`). */
const RIDE_SPEED = laneSpeed(RIDE_ROW, 1);

/** The center the critter is posed at: one unit inside the column's left edge. */
const START_X = tileLeft(COL) + 1;

/**
 * The ticks of drift taken before the hop.
 *
 * Enough that the critter is plainly being carried, few enough that the center is
 * still far from the column's own center when the hop is taken and far from
 * either boundary of it.
 */
const DRIFT_TICKS = 4;

/**
 * How far from the tile's center the critter must be when it hops, in units.
 *
 * A quarter of a tile: below that the "translates by `TILE`" model would land
 * close enough to the target center to pass, and the check would decide nothing.
 * The pose above puts it about eleven units out.
 */
const MIN_OFFSET = TILE / 4;

/**
 * The decimal places the landing centre is read to, on both axes.
 *
 * Six. `specs/hopping.md` makes a hop an assignment — it "sets the critter's
 * center to the target tile's center exactly" — and both `tileCX(20)` and
 * `tileCY(6)` are whole numbers, so the only slack a conformant build needs is
 * the last bits of a double. Nothing carries the landing off that centre either:
 * the landing row is laid by `poseLane`, which parks its lane at rest, so the
 * tick that lands the hop moves nothing afterwards.
 */
const CENTRE_DIGITS = 6;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("sets the center to the target tile's center exactly when hopping off a drifting floe", async () => {
  await startCrossing(harness);
  // The landing row first, held at rest; then the riding row, set drifting.
  await poseLane(harness, TARGET_ROW, "raft4", [COL - 2]);
  await poseLane(harness, RIDE_ROW, "raft3", [COL - 1]);
  await harness.debug.setLaneDirection(RIDE_ROW, 1);
  await harness.debug.setLaneSpeed(RIDE_ROW, RIDE_SPEED);
  await harness.debug.addCritter(COL, RIDE_ROW);
  await harness.debug.setCritterX(START_X);

  const hopped = await captureReplay(harness, "hop", async () => {
    await harness.advance(DRIFT_TICKS);
    const riding = await harness.snapshot();
    assertEqual(riding.critter.col, COL, "the column the hop is taken from");
    assertGreaterThan(
      Math.abs(riding.critter.x - tileCX(COL)),
      MIN_OFFSET,
      "the center's distance from its tile's center when the hop is taken",
    );

    await harness.tap(HOP_KEY.up);
    return harness.snapshot();
  });

  assertEqual(hopped.critter.row, TARGET_ROW, "the row one hop up");
  assertEqual(hopped.critter.col, COL, "the column the hop was taken from");
  assertCloseTo(
    hopped.critter.x,
    tileCX(COL),
    CENTRE_DIGITS,
    `the center x, tileCX(${COL})`,
  );
  assertCloseTo(
    hopped.critter.y,
    tileCY(TARGET_ROW),
    CENTRE_DIGITS,
    `the center y, tileCY(${TARGET_ROW})`,
  );
});
