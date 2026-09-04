// Meltdown — surge/walks-at-its-speed: a unit covers its own speed's worth of
// floor in a second of game time.
//
// THE RULE. `specs/surge.md`: "Speed is the unit's base speed, in logical units
// per second". `specs/mazing.md`: "A unit travels toward the centre of the next
// tile of its route at its current speed, in logical units per second." So a Mote
// covers `60` logical units of open floor per second of game time and a Sprint
// `120`, and `specs/waves.md` makes that a claim about GAME time: every rate "is
// per second and is integrated against that game time", so an interval reaches
// the same place however it was divided into frames.
//
// TWO TYPES, BECAUSE ONE FIGURE CANNOT TELL A TABLE FROM A CONSTANT. A build that
// walks everything at one speed covers the same distance twice, and the pair is
// what makes this a reading of the roster's Speed column rather than of a single
// number. The Mote's `60` and the Sprint's `120` are the two ends of the ground
// roster and exactly a factor of two apart, so a build that halved, doubled, or
// flattened its speeds lands on neither.
//
// BOTH ARE MEASURED OVER THE SAME WINDOW, on the same floor, in one drive. They
// walk different rows and never meet, and neither is a bystander: both are the
// subject.
//
// WHERE THEY WALK, AND WHY THE ROUTE CANNOT BEND. `specs/floor.md` puts the left
// vent on rows `16..19` and the right exhaust on the same four rows, and
// `specs/mazing.md` assigns the left vent's units the right exhaust and measures
// a route at `1` per orthogonal step and `sqrt(2)` per diagonal. From a tile on
// one of those four rows on an EMPTY floor the cheapest route is therefore the
// straight run east along that row — every route that changes row costs at least
// one diagonal, which is `sqrt(2) - 1` dearer and never repaid. So the straight
// line between the two readings IS the distance travelled, and no arrangement
// here demands a route the specification leaves free.
//
// THE WINDOW IS TWO SECONDS AND STARTS TWENTY-SIX TILES SHORT OF THE EXHAUST, so
// the Sprint's `240` units leave it still well inside the floor: nothing here
// reads a departure, and neither unit's walk is cut short by the opening it is
// heading for.
//
// WHAT THIS ITEM DOES NOT DECIDE. That a slow changes the figure is
// `specs/combat.md`'s and the combat group's; that a wall lengthens the route is
// the mazing group's; that a flyer ignores the route entirely is
// `mazing/flyer-flies-straight`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import {
  LEFT_VENT_ROWS,
  SURGE_DEFS,
  tileCX,
  tileCY,
  type SurgeType,
} from "../constants";
import {
  TICK_HZ,
  captureStill,
  createHarness,
  distance,
  framesFor,
  poseWalker,
  requireUnit,
  startRun,
  type Harness,
} from "../harness";

/** The two types read, and the rows of the left corridor each one walks. */
const MOTE_ROW = LEFT_VENT_ROWS[0];
const SPRINT_ROW = LEFT_VENT_ROWS[3];

/**
 * The column both walks start from.
 *
 * Twenty-six tiles of open row lie east of it before the exhaust, which is more
 * than twice the `12.6` tiles the faster of the two covers in the window.
 */
const START_COL = 4;

/** How long both are watched, in seconds of game time. */
const WINDOW_SECONDS = 2;
const WINDOW_FRAMES = framesFor(WINDOW_SECONDS);

/**
 * How far a distance covered may sit from `speed * seconds`, as a multiple of one
 * frame of that type's own travel.
 *
 * The figure is exact arithmetic on both sides, so the bound is set by the
 * boundaries of the drive rather than by any slack the specification allows: the
 * frame the unit is posed on and the frame the window closes on may each be
 * resolved a whisker differently by a conformant build, and three frames is
 * generous margin over the two. At the Mote's `60` that is `1.5` logical units in
 * `120`, and at the Sprint's `120` it is `3` in `240` — a hundredth of the
 * reading either way, and a hundred and twentieth of the gap between the two
 * speeds this item has to tell apart.
 */
const FRAME_MARGIN = 3;

/** The distance `type` must cover in the window, and how far off it may be. */
function expected(type: SurgeType): number {
  return SURGE_DEFS[type].speed * WINDOW_SECONDS;
}
function tolerance(type: SurgeType): number {
  return (FRAME_MARGIN * SURGE_DEFS[type].speed) / TICK_HZ;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("walks a Mote 60 units and a Sprint 120 units per second of game time", async () => {
  await startRun(h);

  const mote = await poseWalker(h, "mote", "left");
  await h.debug.setUnitPosition(mote, tileCX(START_COL), tileCY(MOTE_ROW));
  const sprint = await poseWalker(h, "sprint", "left");
  await h.debug.setUnitPosition(sprint, tileCX(START_COL), tileCY(SPRINT_ROW));

  const opened = await h.snapshot();
  const moteFrom = requireUnit(
    opened,
    mote,
    "the Mote at the start of its walk",
  );
  const sprintFrom = requireUnit(
    opened,
    sprint,
    "the Sprint at the start of its walk",
  );

  await h.advance(WINDOW_FRAMES);
  await captureStill(h, "travel");
  const settled = await h.snapshot();
  const moteTo = requireUnit(settled, mote, "the Mote at the end of its walk");
  const sprintTo = requireUnit(
    settled,
    sprint,
    "the Sprint at the end of its walk",
  );

  assertLessThanOrEqual(
    Math.abs(distance(moteFrom, moteTo) - expected("mote")),
    tolerance("mote"),
    `over ${WINDOW_SECONDS} s of game time a Mote covers ${expected("mote")} ` +
      `logical units at its own ${SURGE_DEFS.mote.speed} per second ` +
      `(specs/surge.md); it covered ` +
      `${distance(moteFrom, moteTo).toFixed(3)}, off by`,
  );
  assertLessThanOrEqual(
    Math.abs(distance(sprintFrom, sprintTo) - expected("sprint")),
    tolerance("sprint"),
    `over ${WINDOW_SECONDS} s of game time a Sprint covers ` +
      `${expected("sprint")} logical units at its own ` +
      `${SURGE_DEFS.sprint.speed} per second (specs/surge.md); it covered ` +
      `${distance(sprintFrom, sprintTo).toFixed(3)}, off by`,
  );
});
