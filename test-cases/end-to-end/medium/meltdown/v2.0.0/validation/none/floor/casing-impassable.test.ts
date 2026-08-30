// floor/casing-impassable — the casing cannot be crossed.
//
// THE RULE. `specs/floor.md`: "The casing is impassable and is not part of the
// tile grid. A surge unit never crosses it, so a unit's centre leaves the floor
// rectangle only through one of the four openings." The floor rectangle is
// `(FLOOR_X0, FLOOR_Y0)` to `(FLOOR_X1, FLOOR_Y1)`, `(18, 18)` to `(968, 702)`,
// and leaving through an opening removes the unit rather than moving it outside:
// `specs/mazing.md` removes a unit on the frame the tile its centre occupies is
// an opening tile of its assigned exhaust. So the whole rule reduces to one
// invariant with no exceptions to carve out — WHILE A UNIT IS ON THE FLOOR, ITS
// CENTRE IS INSIDE THAT RECTANGLE — and that is what this check watches.
//
// WHERE THE SURGE IS POSED, AND WHY. Ten units are stood on the floor's own
// perimeter tiles, on all four walls and in all four corners, and let walk. That
// is the arrangement the rule is about: a unit already against the wall, with a
// route that runs along it. Both vents are represented, so both assigned
// exhausts are, and the flyer is here too because `specs/mazing.md` gives it a
// straight line rather than a route and a straight line is the easier thing to
// overshoot. The types are the slow ones — a Core at 30 units per second and a
// Hulk at 38 — so the walking lasts the minute rather than being over in five
// seconds, with one Sprint at 120 because the fastest unit is the one most likely
// to step through a wall.
//
// THE ANTI-VACUITY LEG, AND WHY IT IS HERE. A floor on which nothing moves
// satisfies a containment invariant perfectly, so the check would pass a build
// whose surge never walks at all. So the drive also measures how far the ten
// units got, and requires the total to clear a floor's width. It is the same
// shape the pause items take, and for the same reason: a claim about what did NOT
// happen is only worth anything beside evidence that the thing which had to
// happen did.
//
// WHAT THIS DOES NOT DECIDE. Which route a unit takes, whether it takes the
// cheapest one, and whether it ever leaves at all belong to `mazing`. A unit that
// walks in circles inside the casing for a minute passes this item, and should:
// the casing held.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertTrue } from "../assert";
import {
  FLOOR_H,
  FLOOR_W,
  FLOOR_X0,
  FLOOR_X1,
  FLOOR_Y0,
  FLOOR_Y1,
  ROWS,
  COLS,
  tileCX,
  tileCY,
  type SurgeType,
  type Vent,
} from "../constants";
import {
  captureStill,
  createHarness,
  distance,
  framesFor,
  poseWalker,
  startRun,
  type Harness,
  type MeltdownSnapshot,
  type UnitView,
} from "../harness";

/**
 * How far outside the floor rectangle a centre may read, in logical units.
 *
 * `specs/floor.md` allows none at all: the rectangle is the wall's inner face.
 * One unit is granted for the arithmetic of arriving, not for the wall — a unit
 * travels toward the centre of the next tile of its route, and the fastest unit
 * in the game, the Sprint at `120` logical units per second (`specs/surge.md`),
 * covers exactly one unit in a frame of the suite's 120 Hz clock, so a build that
 * lands a frame's step a whisker past a target and corrects on the next is inside
 * this. It is a fiftieth of the nineteen-unit tile the nearest legal target sits
 * in the middle of, so nothing that has actually entered the casing fits under
 * it: the tile centres nearest the wall are nine and a half units clear of it.
 */
const OVERSHOOT_MAX = 1;

/** How long the surge is watched, in seconds of game time. */
const WATCH_SECONDS = 60;

/**
 * Frames between two readings: a tenth of a second, in which the fastest unit in
 * the game covers twelve of the nineteen units a tile is wide.
 *
 * So a unit that stepped through the wall is read while it is still only just
 * through, rather than after it has had time to wander back.
 */
const POLL_FRAMES = 12;

/**
 * The distance the ten units must cover between them, in logical units: one
 * floor width.
 *
 * The anti-vacuity bound, and deliberately far below what a walking floor
 * produces — a single Core crossing the floor covers most of it on its own, and
 * ten units over a minute cover several thousand units between them. It is here
 * to fail a floor that never moved, not to measure a speed.
 */
const MIN_TOTAL_TRAVEL = FLOOR_W;

/** Where each unit is stood, and which vent it belongs to. */
const PERIMETER: readonly {
  type: SurgeType;
  vent: Vent;
  col: number;
  row: number;
}[] = [
  // Against the left and right walls, walking to the right exhaust.
  { type: "core", vent: "left", col: 0, row: 0 },
  { type: "core", vent: "left", col: 0, row: ROWS - 1 },
  { type: "hulk", vent: "left", col: 24, row: 0 },
  { type: "hulk", vent: "left", col: 24, row: ROWS - 1 },
  { type: "sprint", vent: "left", col: 0, row: 8 },
  // And to the bottom exhaust, which runs the other pair of walls.
  { type: "core", vent: "top", col: COLS - 1, row: 0 },
  { type: "core", vent: "top", col: 0, row: 17 },
  { type: "hulk", vent: "top", col: COLS - 1, row: 17 },
  { type: "hulk", vent: "top", col: 5, row: 0 },
  // The flyer, which takes a line rather than a route (specs/mazing.md).
  { type: "drift", vent: "top", col: 0, row: 0 },
];

/** How far outside the floor rectangle a centre sits, in logical units. */
function outside(unit: UnitView): number {
  return Math.max(
    FLOOR_X0 - unit.x,
    unit.x - FLOOR_X1,
    FLOOR_Y0 - unit.y,
    unit.y - FLOOR_Y1,
    0,
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("never lets a unit's centre out of the floor rectangle", async () => {
  await startRun(h);

  for (const stand of PERIMETER) {
    const id = await poseWalker(h, stand.type, stand.vent);
    await h.debug.setUnitPosition(id, tileCX(stand.col), tileCY(stand.row));
  }

  // Where each unit started and where it was last seen, so the drive can say
  // whether the floor moved at all.
  const first = new Map<number, { x: number; y: number }>();
  const last = new Map<number, { x: number; y: number }>();
  /** The worst reading the whole drive produced, and whose it was. */
  let breach: { unit: UnitView; over: number } | null = null;

  const watch = (snapshot: MeltdownSnapshot): boolean => {
    for (const unit of snapshot.surge) {
      if (!first.has(unit.id)) first.set(unit.id, { x: unit.x, y: unit.y });
      last.set(unit.id, { x: unit.x, y: unit.y });
      const over = outside(unit);
      if (over > OVERSHOOT_MAX && (breach === null || over > breach.over)) {
        breach = { unit, over };
      }
    }
    return breach !== null;
  };

  // A short first stretch, so the evidence still shows the surge walking the
  // walls rather than standing where it was posed.
  const opening = 2;
  await h.until(watch, {
    maxFrames: framesFor(opening),
    poll: POLL_FRAMES,
  });
  await captureStill(h, "casing");
  await h.until(watch, {
    maxFrames: framesFor(WATCH_SECONDS - opening),
    poll: POLL_FRAMES,
  });

  if (breach !== null) {
    const { unit, over } = breach as { unit: UnitView; over: number };
    assertTrue(
      false,
      `unit ${unit.id} (${unit.type}) stayed inside the floor rectangle ` +
        `x [${FLOOR_X0}, ${FLOOR_X1}] y [${FLOOR_Y0}, ${FLOOR_Y1}] ` +
        `(specs/floor.md); it read (${unit.x}, ${unit.y}), ${over} units out`,
    );
  }

  // And the minute was a minute of walking.
  let travelled = 0;
  for (const [id, from] of first) {
    const to = last.get(id);
    if (to !== undefined) travelled += distance(from, to);
  }
  assertGreaterThanOrEqual(
    travelled,
    MIN_TOTAL_TRAVEL,
    `logical units covered by the surge over ${WATCH_SECONDS}s, summed over ` +
      `${PERIMETER.length} units, so the containment above was measured on a ` +
      `floor that was actually walking (the floor is ${FLOOR_W} by ${FLOOR_H})`,
  );
});
