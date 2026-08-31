// Meltdown — instrumentation/unit-motion-gate-leaves-pathing: motion off leaves
// the unit's route live.
//
// `specs/instrumentation.md`: "Off, the unit holds its position, and its route is
// still computed from the tile it stands on, so `remaining` still follows the
// floor and rises when a wall is built across its way." `specs/mazing.md` says
// when: "Every route is recomputed on the frame the set of blocked tiles changes:
// a tower placed, a tower sold, or a tower otherwise added to or removed from the
// floor. Each unit's route is recomputed from the tile its centre occupies at
// that moment, and a recomputation moves nothing."
//
// THE GATE IS WHAT MAKES THE READING CLEAN, NOT WHAT MAKES IT HARD. With motion
// off the unit cannot move between the two readings, so the whole of the change
// in `remaining` is the route's — where a walking unit's `remaining` falls as it
// travels and a rise would have to be teased out of that fall.
//
// THE WALL IS BUILT WHERE IT MUST LENGTHEN THE ROUTE, AND BY HOW MUCH IS
// DERIVABLE. `ground.ts` walls columns `20` and `21` across rows `14` through
// `21`, and the unit stands on the left corridor at column `5`. `specs/mazing.md`
// costs an orthogonal step `1` and a diagonal `sqrt(2)`, and puts the right
// exhaust's openings on rows `16..19` (`specs/floor.md`), so any route from the
// unit's tile to an opening must now leave rows `14..21` before column `20` and
// come back to rows `16..19` after column `21`: at least seven of its steps
// change row, which under that metric costs at least `7 * (sqrt(2) - 1)` — near
// three tiles — more than the straight run it replaced. The bound read against is
// well inside that.
//
// THE READING IS TAKEN AFTER ONE FRAME, not at the call, because
// `specs/mazing.md` puts the recomputation on the FRAME the blocked set changes
// and a build is free to do it in that frame's update rather than inside the
// call. With the unit held, that frame moves nothing else, so what the frame can
// have changed is the route alone.
//
// THE WALL IS ADDED WITH `addTower`, which "runs no placement check": the wall
// would otherwise have to be affordable and to satisfy `specs/mazing.md`'s
// never-seal rule at every one of its four footprints, and neither has anything
// to do with this point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import {
  captureStill,
  createHarness,
  distance,
  positionOf,
  startRun,
  type Harness,
} from "../harness";
import { buildWall, OPEN_ROW, poseWalkerAt, readUnit } from "./ground";

/**
 * The least the wall must lengthen the held unit's route by, in tiles.
 *
 * The detour `specs/mazing.md` forces costs at least `7 * (sqrt(2) - 1)`, near
 * three tiles, over the straight corridor it replaces. One tile is comfortably
 * under that and far above the float a `sqrt(2)` leaves behind.
 */
const MIN_RISE = 1;

/**
 * How far the unit's centre may move across the frame the wall lands on, in
 * logical units.
 *
 * `specs/mazing.md`: "a recomputation moves nothing: every unit's centre on the
 * frame the floor changed is exactly where the frame's own movement left it" —
 * and this unit's motion is held, so the frame's own movement is none. The
 * allowance is for the float the coordinates are stored in.
 */
const HELD_TOLERANCE = 1e-9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("raises a held unit's remaining when a wall is built across its way", async () => {
  startRun(h);

  const id = poseWalkerAt(h, "mote", OPEN_ROW);
  h.debug.setUnitMotion(id, false);
  await h.advance(1);

  const before = readUnit(h.snapshot(), id, "the held unit on the open corridor");
  assertEqual(before.motion, false, "precondition: the unit's motion is held");
  assertEqual(
    before.flying,
    false,
    "precondition: the unit walks the maze rather than over it",
  );
  assertGreaterThan(
    before.remaining,
    MIN_RISE,
    "precondition: the unit has a route left to lengthen",
  );
  const wasAt = positionOf(before);

  buildWall(h);
  await h.advance(1);
  captureStill(h, "repathed");

  const after = readUnit(h.snapshot(), id, "the held unit after the wall landed");
  assertLessThan(
    distance(wasAt, positionOf(after)),
    HELD_TOLERANCE,
    "the logical units the held unit moved while the wall landed",
  );
  assertGreaterThan(
    after.remaining - before.remaining,
    MIN_RISE,
    "the tiles the wall added to the held unit's route",
  );
});
