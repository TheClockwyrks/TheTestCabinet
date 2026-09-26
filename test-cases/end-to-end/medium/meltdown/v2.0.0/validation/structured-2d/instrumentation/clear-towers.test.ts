// Meltdown — instrumentation/clear-towers: `clearTowers` empties the towers
// alone.
//
// `specs/instrumentation.md`: "`clearTowers()` — Removes every tower, reopening
// every footprint and recomputing the routes. It pays no refund and changes
// neither money nor score, and it leaves the surge standing."
//
// FOUR CONSEQUENCES, AND EACH OF THEM IS READ. The roster empties; every tile a
// footprint held is open floor again; the routes are recomputed, which
// `specs/mazing.md` says happens "on the frame the set of blocked tiles changes";
// and the surge is untouched.
//
// THE ROUTES ARE READ AS A LENGTH THAT COMES BACK. A tile-by-tile reading of what
// is blocked would pass a build that dropped its towers and left a stale route
// behind, which is exactly the failure "recomputing the routes" is written
// against. So the two vent-to-exhaust lengths are taken on the EMPTY floor first,
// a wall is built across the left corridor to lengthen one of them, and the
// clear must give that length back. `specs/mazing.md` fixes the metric — an
// orthogonal step costs `1` and a diagonal `sqrt(2)` — so what comes back is
// exactly the figure the floor started at.
//
// THE WALL IS THE FLOOR'S OWN GEOMETRY, NOT A THRESHOLD. `ground.ts` anchors it
// across the left corridor's rows deliberately, because a tower posed anywhere
// quiet would leave both lengths where they were and this reading would be of
// nothing.
//
// THE SURGE IS READ BY ID, not by count: a build that cleared the units and let
// the wave release replacements would keep the count and change the ids.
//
// The refund and the score belong to `clear-towers-pays-nothing`, so that a
// build with a working clear and a leaking purse is graded apart from one whose
// clear does not clear.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertDeepEqual,
  assertGreaterThan,
  assertLength,
} from "../assert";
import {
  blockedTiles,
  captureStill,
  createHarness,
  startRun,
  tileCenter,
  type Harness,
} from "../harness";
import { buildWall, quietSite } from "./ground";

/** The units posed on the floor, which the clear must leave standing. */
const UNITS = 3;

/**
 * How far a restored route length may sit from the length the empty floor had,
 * in tiles.
 *
 * The floor is put back exactly as it was, so a build that recomputed its routes
 * arrives at the identical figure and the allowance is for the float a `sqrt(2)`
 * leaves behind. A millionth of a tile is many orders above that and far below
 * the whole tiles a stale route is out by.
 */
const ROUTE_DIGITS = 6;

/**
 * The least the wall must lengthen the left route by, in tiles, for the reading
 * to mean anything.
 *
 * `ground.ts` walls columns `20..21` across rows `14..21`, so a ground unit must
 * leave the left corridor's rows before column `20` and return to the exhaust's
 * rows after column `21`: at least seven of its steps become diagonal, which
 * costs at least `7 * (sqrt(2) - 1)`, near three tiles. One tile is comfortably
 * under that and far above nothing at all.
 */
const MIN_LENGTHENING = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes every tower, reopens every footprint, gives the routes back and leaves the surge", async () => {
  startRun(h);
  const empty = h.snapshot();
  assertLength(empty.towers, 0, "precondition: the floor opened empty");
  const emptyLeft = empty.paths.left.length;
  const emptyTop = empty.paths.top.length;

  // A floor with towers of all three footprint sizes, both movers, and a wall
  // across the left corridor so a route really is longer than it was.
  const arc = quietSite(0);
  const bloom = quietSite(1);
  const lance = quietSite(2);
  h.debug.addTower("arc", arc.col, arc.row, 0);
  h.debug.addTower("bloom", bloom.col, bloom.row, 0);
  h.debug.addTower("lance", lance.col, lance.row, 0);
  const forge = quietSite(3);
  const sink = quietSite(4);
  h.debug.addTower("forge", forge.col, forge.row, 0);
  h.debug.addTower("sink", sink.col, sink.row, 0);
  buildWall(h);

  // Units the clear must leave alone, held on their tiles so nothing of theirs
  // moves for a reason other than the clear.
  for (let i = 0; i < UNITS; i += 1) {
    h.debug.addUnit("mote", "left");
    const surge = h.snapshot().surge;
    const unit = surge[surge.length - 1];
    const site = quietSite(i + 8);
    const at = tileCenter(site.col, site.row);
    h.debug.setUnitPosition(unit.id, at.x, at.y);
    h.debug.setUnitMotion(unit.id, false);
  }

  await h.advance(1);
  const built = h.snapshot();
  assertLength(
    built.towers,
    9,
    "precondition: the towers the floor was posed with",
  );
  assertLength(
    built.surge,
    UNITS,
    "precondition: the units the floor was posed with",
  );
  assertGreaterThan(
    built.paths.left.length - emptyLeft,
    MIN_LENGTHENING,
    "precondition: the wall lengthened the left route",
  );
  const unitsBefore = built.surge.map((unit) => unit.id);

  h.debug.clearTowers();
  await h.advance(1);
  captureStill(h, "cleared");
  const cleared = h.snapshot();

  assertLength(cleared.towers, 0, "the tower roster after clearTowers");
  assertLength(
    blockedTiles(cleared),
    0,
    "the tiles still blocked after clearTowers",
  );
  assertCloseTo(
    cleared.paths.left.length,
    emptyLeft,
    ROUTE_DIGITS,
    "the left route, recomputed on the reopened floor",
  );
  assertCloseTo(
    cleared.paths.top.length,
    emptyTop,
    ROUTE_DIGITS,
    "the top route, recomputed on the reopened floor",
  );
  assertDeepEqual(
    cleared.surge.map((unit) => unit.id),
    unitsBefore,
    "the surge clearTowers left standing, by id",
  );
});
