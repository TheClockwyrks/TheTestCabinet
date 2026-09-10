// mazing/partial-opening-allowed — a footprint may cover part of an opening.
//
// `specs/mazing.md`: "An opening's tiles are ordinary floor, so a footprint may
// cover part of an opening. A footprint covering three of the left vent's four
// opening tiles is allowed, because the route through the fourth remains."
// `specs/floor.md` says the same of the tiles themselves: "An opening's tiles are
// ordinary floor. A surge unit walks onto them and a tower footprint may cover
// them, subject to the never-seal rule".
//
// THE FOOTPRINT POSED. `specs/floor.md` opens the left vent onto tiles (0, 16)
// through (0, 19). A 3x3 Bloom anchored at (0, 16) covers columns 0..2 of rows
// 16..18, which is three of those four tiles and leaves (0, 19). This is the
// exact case the specification names, so it is the case the check poses.
//
// THE DIRECTION THIS POINT DECIDES. That the placement is ALLOWED — reads valid,
// and then really places. The refusals are their own items: the footprint that
// closes the fourth tile too is `mazing/seal-refused`, and the five other
// conditions of `specs/building.md` are `building/*`.
//
// WHAT IS READ AFTER IT LANDS. `paths.left.length`. Covering three of the four
// tiles leaves the route running east along row 19 with nothing in its way, so
// the length is unchanged at `49` tiles — and that unchanged figure is the whole
// content of "the route through the fourth remains". A build that instead
// reported no route, or a longer one, has walled an opening tile it had no
// business walling.
//
// THE MONEY. Containment Medium starts on `250` (`specs/modes.md`) and a Bloom
// costs `150` (`specs/towers.md`), so the placement is affordable and the fourth
// condition of `specs/building.md` plays no part in the verdict.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertLessThanOrEqual } from "../assert";
import { LEFT_VENT_ROWS, TOWER_DEFS, type TowerType } from "../constants";
import { blockedSet, routeLength } from "../routes";
import {
  captureStill,
  createHarness,
  lastTower,
  startRun,
  type Harness,
} from "../harness";
import { type Footprint } from "./geometry";

/** The 3x3 type, whose footprint covers three of the vent's four tiles. */
const COVER_TYPE: TowerType = "bloom";

/**
 * The footprint: anchored on the vent's first row against the west casing, so it
 * covers rows 16..18 of column 0 and leaves row 19 open.
 */
const COVER: Footprint = { type: COVER_TYPE, col: 0, row: LEFT_VENT_ROWS[0] };

/** The vent tile the footprint leaves open: the fourth. */
const LEFT_OPEN_ROW = LEFT_VENT_ROWS[LEFT_VENT_ROWS.length - 1];

/** What the metric gives for the left route with that footprint down: 49 tiles. */
const ROUTE_THROUGH = routeLength(blockedSet([COVER]), "left");

/**
 * How far the reported length may sit from the computed one, in tiles.
 *
 * The figure is a sum of `1`s and `sqrt(2)`s (`specs/mazing.md`), so a conforming
 * build differs only in the last bits of a double. The bound is set by what has
 * to stay separated: the cheapest detour any extra blocking would force costs at
 * least `0.8284` tiles, so a fortieth of that gap tells a route running through
 * the fourth tile from one running around something.
 */
const TOLERANCE = 0.01;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("places a footprint covering three of the left vent's four tiles", async () => {
  await startRun(h);
  const before = await h.snapshot();

  await h.debug.setArmed(COVER_TYPE);
  await h.debug.setPreview(COVER.col, COVER.row);
  await h.advance(1);
  await captureStill(h, "allowed");

  // THE FRAME ABOVE IS THE PICTURE, NOT THE READING. A frame hands the build a
  // frame of input, and nothing in `specs/instrumentation.md` makes a pose
  // survive one: `specs/building.md` writes "The preview follows the pointer"
  // as an invariant over the pointer's own `(x, y)`, so a build that
  // re-establishes it every frame is reading that sentence rather than breaking
  // it. So the pose is taken again for the READING, and brought into agreement
  // through the surface's own refresher — `reconcile()` "brings every value the
  // snapshot reports into agreement with the game as it now stands, without
  // advancing anything", and `build.valid` is one of the derived fields it
  // answers for (`specs/instrumentation.md`).
  await h.debug.setArmed(COVER_TYPE);
  await h.debug.setPreview(COVER.col, COVER.row);
  await h.debug.reconcile();

  const held = (await h.snapshot()).build;
  assertEqual(
    held?.valid,
    true,
    `a ${TOWER_DEFS[COVER_TYPE].size}x${TOWER_DEFS[COVER_TYPE].size} ` +
      `footprint at (${COVER.col}, ${COVER.row}) covers three of the left ` +
      `vent's four opening tiles and leaves (0, ${LEFT_OPEN_ROW}), so the ` +
      `route through the fourth remains (specs/mazing.md); whether the build ` +
      `read it as placeable was`,
  );

  await h.debug.place();
  const after = await h.snapshot();

  assertLength(
    after.towers,
    before.towers.length + 1,
    "the towers on the floor after placing on the partly-covered opening",
  );
  assertEqual(
    lastTower(after)?.col,
    COVER.col,
    "the placed tower's footprint column",
  );
  assertEqual(
    lastTower(after)?.row,
    COVER.row,
    "the placed tower's footprint row",
  );
  assertLessThanOrEqual(
    Math.abs(after.paths.left.length - ROUTE_THROUGH),
    TOLERANCE,
    `the left route through the one opening tile left uncovered is ` +
      `${ROUTE_THROUGH.toFixed(4)} tiles; the build reported ` +
      `${after.paths.left.length.toFixed(4)}, off by`,
  );
});
