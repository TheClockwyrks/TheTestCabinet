// torpedo/wraps — a torpedo leaving one edge re-enters at the opposite one.
//
// THE RULE. `specs/weapons.md`, "The torpedo", The flight: "It WRAPS at the
// field's edges CARRYING ITS SPEED". `specs/field.md` fixes what a wrap is — the
// field is a torus, and a body's position is brought back into `[0, FIELD_W)` on
// the x axis — so a torpedo whose centre passes `x = 1280` re-enters at `x = 0`
// on the same row, unchanged in every other respect.
//
// BOTH HALVES OF THE SENTENCE ARE READ. Where it comes back — the row it was on,
// the column the wrap puts it in — and that it is still travelling at
// `TORPEDO_SPEED` when it gets there. A build that clamps a torpedo at the edge
// rather than wrapping it never leaves `x = 1280`; one that removes it at the edge
// leaves nothing to read at all, and the hard assertion names that; one that wraps
// the position but zeroes or halves the velocity comes back at the right place and
// the wrong speed.
//
// THE SEAM IS THE HARNESS'S OWN. `SEAM.right` is `(1279, 620)`: one unit inside
// the right edge and `100` units up from the bottom one, which puts it `690` units
// from the star's centre, where the well pulls at about `9` units per second
// squared — and a torpedo is not pulled at all (`specs/gravity.md`). What carries
// it across the seam is the velocity `addTorpedo` gave it and nothing else. It is
// deliberately off both midlines through the star, so nothing about this crossing
// is a special case of the star's own geometry.
//
// THE GUIDANCE IS HELD OFF so the crossing is a straight one. The field is empty,
// so nothing conforming could turn it; the gate is what stops a build that treats
// the star as an acquirable body from turning the reading into a curve.
//
// TWENTY-FOUR TICKS, which is `84` units of travel: comfortably past the one unit
// to the seam, so the crossing has certainly happened, and short enough that the
// re-entry is still near the left edge where a reviewer can see it.

import { afterEach, beforeEach, it } from "vitest";
import { FIELD_W, TORPEDO_SPEED } from "../../src/constants";
import { assertLessThan, assertLessThanOrEqual } from "../assert";
import { speedOf, wrapCoordinate } from "../geometry";
import { SEAM } from "../fixtures";
import {
  captureStill,
  createHarness,
  requireTorpedo,
  startPlaying,
  type Harness,
} from "../harness";
import {
  TORPEDO_TICK_TRAVEL,
  holdItsHeading,
  poseTorpedo,
  standTheShipClear,
} from "./scenario";

/** Where the torpedo starts: one unit inside the right edge, off the star's row. */
const START = SEAM.right;
/** Along `+x`, straight at the seam. */
const HEADING = 0;

/** How long it is flown for: 84 units, well past the one unit to the edge. */
const FLIGHT_TICKS = 24;

/** Where the wrap puts it: the start plus its travel, brought back into the field. */
const WANTED_X = wrapCoordinate(
  START.x + TORPEDO_TICK_TRAVEL * FLIGHT_TICKS,
  FIELD_W,
);

/**
 * How far from that column the torpedo may read, in units.
 *
 * One tick of its own travel, `3.5` units. `specs/field.md` makes the wrap exact,
 * and this is not room on it: it covers a build that applies its wrap before its
 * move rather than after, which is one tick of travel and nothing more. It is a
 * three-hundredth of the field's width, so a build that clamped at the edge
 * (`1280`) or reflected off it is nowhere near it.
 */
const POSITION_TOLERANCE = TORPEDO_TICK_TRAVEL;

/** How far the row may move: a torpedo crossing a vertical seam changes no `y`. */
const ROW_TOLERANCE = 1;

/**
 * How far the speed may fall from `TORPEDO_SPEED` after the crossing, in units
 * per second: 2 percent, the same allowance `torpedo/speed` reads a straight
 * second of flight against.
 */
const SPEED_TOLERANCE = 0.02 * TORPEDO_SPEED;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("re-enters at the left edge, on its row and at its speed, after crossing the right one", async () => {
  startPlaying(h);
  standTheShipClear(h);
  const id = poseTorpedo(h, START.x, START.y, HEADING);
  holdItsHeading(h, id);

  await h.advance(FLIGHT_TICKS);
  const after = requireTorpedo(
    h.snapshot(),
    id,
    "the torpedo still in flight after crossing the right edge — a torpedo " +
      "wraps at the field's edges rather than being removed at one " +
      "(specs/weapons.md, specs/field.md)",
  );
  // The torpedo re-entering at the opposite edge.
  captureStill(h, "wrap");

  assertLessThan(
    after.x,
    START.x,
    "the torpedo to have crossed the right edge and come back at the left, " +
      `so its column is behind the ${START.x} it started at rather than past ` +
      "it (specs/field.md); a build that clamps or reflects at the edge reads " +
      "a column at or beyond the start",
  );
  assertLessThanOrEqual(
    Math.abs(after.x - WANTED_X),
    POSITION_TOLERANCE,
    `the torpedo at x = ${WANTED_X.toFixed(1)} after ${FLIGHT_TICKS} ticks — ` +
      `${(TORPEDO_TICK_TRAVEL * FLIGHT_TICKS).toFixed(1)} units of travel from ` +
      `x = ${START.x}, brought back into the field — within ` +
      `${POSITION_TOLERANCE.toFixed(1)} (specs/field.md, specs/weapons.md); ` +
      `read ${after.x.toFixed(1)}`,
  );
  assertLessThanOrEqual(
    Math.abs(after.y - START.y),
    ROW_TOLERANCE,
    `the torpedo still on the row it crossed on, y = ${START.y}, within ` +
      `${ROW_TOLERANCE} (specs/field.md: the wrap changes the coordinate that ` +
      `left the field and nothing else); read ${after.y.toFixed(1)}`,
  );

  const speed = speedOf(after);
  assertLessThanOrEqual(
    Math.abs(speed - TORPEDO_SPEED),
    SPEED_TOLERANCE,
    `the torpedo still travelling at TORPEDO_SPEED (${TORPEDO_SPEED}) after ` +
      `the wrap, within ${SPEED_TOLERANCE.toFixed(1)} units per second — it ` +
      "wraps at the field's edges CARRYING ITS SPEED (specs/weapons.md); read " +
      `${speed.toFixed(1)}`,
  );
});
