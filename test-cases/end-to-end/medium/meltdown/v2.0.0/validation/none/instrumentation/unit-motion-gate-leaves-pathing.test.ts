// Meltdown — instrumentation/unit-motion-gate-leaves-pathing: holding a unit still
// holds ITS LOCOMOTION, and leaves its route live underneath.
//
// THE RULE. `specs/instrumentation.md`: "`motion` gates the unit's locomotion ...
// and nothing else. Off, the unit holds its position, and its route is still
// computed from the tile it stands on, so `remaining` still follows the floor and
// rises when a wall is built across its way."
//
// THIS IS THE OTHER HALF OF THE GATE. `instrumentation/unit-motion-gate` decides
// that the unit really stops; this one decides that nothing ELSE stopped with it.
// A build that implemented the gate by taking the unit out of the update
// altogether passes that one completely — it could hardly be stiller — and then
// every `mazing/*` scenario that reads a held unit's `remaining` against a wall
// reads a frozen number, and `combat/*`'s targeting rule, which picks "the
// in-range unit with the smallest `remaining`" (`specs/combat.md`), picks off a
// stale one.
//
// THE READING IS A RISE, NOT A FIGURE. What a route measures on a bare floor, and
// how many tiles a particular wall adds, are `mazing/*`'s items. This check reads
// the held unit's own `remaining` before and after the wall lands on the build's
// own floor, so it grades the same way whatever those figures are.
//
// AND THE UNIT MUST NOT HAVE MOVED WHILE THE ROUTE CHANGED. A `remaining` that
// rose because the unit walked backwards would be a different fault entirely, so
// the centre is read either side of the wall and held to where it was posed.
//
// THE WALL IS A LANCE LAID ACROSS THE WHOLE LEFT CORRIDOR, ahead of where the unit
// stands. A 4x4 footprint (`specs/towers.md`) covers all four rows of the left
// vent (`specs/floor.md`), so the cheapest open route can no longer run straight
// through and must leave the corridor and come back. Under the surge's own step
// rules — an orthogonal step costing `1` tile and a diagonal `sqrt(2)`
// (`specs/instrumentation.md`) — the cheapest such detour replaces at least four
// orthogonal steps with diagonals, so it costs at least `4 * (sqrt(2) - 1)`, about
// `1.66` tiles, more than the straight run it replaced.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { LEFT_VENT_ROWS, tileCX, tileCY } from "../constants";
import { laneTile } from "../fixtures";
import {
  captureStill,
  createHarness,
  distance,
  poseWalker,
  requireUnit,
  startRun,
  type Harness,
} from "../harness";

/** The unit read, and where on the left corridor it is held. */
const UNIT = "mote";
const START_ALONG = 3;

/**
 * Where the wall lands: a Lance across all four rows of the left corridor, well
 * ahead of the unit. Geometry, not a threshold.
 */
const WALL = { col: 12, row: LEFT_VENT_ROWS[0] };

/**
 * How much the route must lengthen, in tiles.
 *
 * Half a tile, against the `1.66` the cheapest detour around a four-tile-tall wall
 * costs under the surge's step rules. A conformant build clears it three times
 * over; what the bound excludes is a `remaining` that did not move at all, and the
 * margin is there because which way round the wall a build routes is its own
 * choice.
 */
const MIN_RISE = 0.5;

/** How far the held unit may drift while the wall lands, in logical stage units. */
const HELD_TOLERANCE = 0.1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises a held unit's remaining on the frame a wall lands across its way", async () => {
  await startRun(h);
  const id = await poseWalker(h, UNIT, "left");
  const at = laneTile("left", START_ALONG);
  await h.debug.setUnitPosition(id, tileCX(at.col), tileCY(at.row));
  await h.debug.setUnitMotion(id, false);

  await h.advance(1);
  const before = requireUnit(await h.snapshot(), id, "the held Mote");
  assertEqual(before.motion, false, "the unit's motion gate was off");

  await h.debug.addTower("lance", WALL.col, WALL.row, 0);
  await h.advance(1);
  await captureStill(h, "repathed");

  const after = requireUnit(await h.snapshot(), id, "the held Mote");
  assertGreaterThan(
    after.remaining - before.remaining,
    MIN_RISE,
    `the tiles the wall added to a held ${UNIT}'s route`,
  );
  assertLessThanOrEqual(
    distance(before, after),
    HELD_TOLERANCE,
    "the logical units the held unit moved while the wall landed",
  );
});
