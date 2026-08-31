// Meltdown — movers/movers-are-walls: a mover walls the floor.
//
// specs/towers.md ends the Forge and the Sink's entry with "Both block their four
// tiles like any other tower", and specs/mazing.md says what blocking means: a
// tower blocks every tile of its footprint whatever kind of tower it is, a blocked
// tile is not open floor, and no surge route passes through one — which the game
// reports as `paths.left.length` and `paths.top.length`. A mover is not an
// exception to either: it is a 2x2 obstacle that lengthens a route exactly as a
// 2x2 emitter standing on the same four tiles would.
//
// WHY THE CORRIDOR TAKES TWO FOOTPRINTS. specs/floor.md opens the left vent onto
// rows `16..19` and its opposite exhaust onto the same four rows, so the corridor
// between them is four tiles deep and a 2x2 footprint dropped on it leaves a
// straight lane open beside itself — correctly. Both movers are 2x2 at every level
// (specs/towers.md), so the span is made of two: a plain Arc holds the corridor's
// southern half in EVERY leg, and the tower under test takes the northern half.
// The Arc is scenery, identical in all four legs, and the only thing that changes
// between them is what stands on those four northern tiles. The floor is never
// sealed — the whole of the rest of the grid is open, so a route always exists
// (specs/mazing.md).
//
// THREE READINGS, EACH DECIDING SOMETHING DIFFERENT.
//
//   - IT BLOCKS ITS FOUR TILES. Read off the floor's own blocked set rather than
//     off a route, so a build that walls a mover's anchor tile alone — or that
//     leaves a mover off the obstacle map altogether — is named for exactly that.
//     The four tiles come from the footprint the check POSED and the size
//     specs/towers.md states, never from the `size` a snapshot reported, so a
//     build that reported the wrong footprint is not checked against its own
//     mistake.
//   - IT LENGTHENS THE ROUTE AT ALL. Held against the same floor with those four
//     tiles open, so a build whose movers are walked straight through fails here.
//   - IT LENGTHENS IT EXACTLY AS AN ARC DOES. The same corridor, the same anchor,
//     an Arc in the mover's place. This is the item's own claim, and it catches a
//     build that blocks a mover's tiles but counts its footprint wrongly — a mover
//     treated as a single tile, or as a 3x3.
//
// WHAT THE ROUTE LENGTH IS IN ABSOLUTE TILES is `mazing/*`'s business, and this
// item does not restate it: every reading here is one floor of a build's own
// search held against another floor of the same build's own search, so a build
// whose metric is wrong fails `mazing/tower-lengthens-the-route` on the metric and
// is graded here only on whether a mover is a wall. A route's TILE SEQUENCE is
// never asserted, and must not be: specs/mazing.md fixes no tie-break among
// equal-cost routes.
//
// BOTH MOVERS ARE READ, because a build that walls its Forge and walks the surge
// through its Sink has half the defect and must grade as having it.
//
// THE GUNS ARE HELD OFF THROUGHOUT: walling is the only faculty this requirement
// exercises, and a firing line has no part in a route length.

import { afterEach, beforeEach, it } from "vitest";
import { LEFT_VENT_ROWS } from "../../src/constants";
import { assertCloseTo, assertContains, assertGreaterThan } from "../assert";
import {
  blockedTiles,
  captureStill,
  createHarness,
  footprintTiles,
  poseIdleTower,
  poseTower,
  sizeOf,
  startRun,
  type Harness,
  type TowerType,
} from "../harness";

/** The tower type the yardstick leg is measured against. */
const PLAIN: TowerType = "arc";

/** The two movers, each of which must wall exactly as the Arc does. */
const MOVERS: readonly TowerType[] = ["forge", "sink"];

/** The route read: the left vent's, to its fixed opposite exhaust. */
const ROUTE = "left";

/**
 * Where the span goes: ten columns into the floor, on the left corridor.
 *
 * The scenery Arc is anchored on the corridor's third row so its 2x2 footprint
 * covers rows `18..19`, and the tower under test on its first row so its footprint
 * covers rows `16..17`. Together they span the corridor's whole four-row run at
 * columns `10..11` (specs/floor.md, The openings). Geometry, not a tolerance.
 */
const SPAN_COL = 10;
const SCENERY_ROW = LEFT_VENT_ROWS[2];
const SUBJECT_ROW = LEFT_VENT_ROWS[0];

/**
 * How close two route lengths must come, as decimal places of a tile.
 *
 * A route length is a sum of `1`s and `sqrt(2)`s (specs/mazing.md), so six places
 * — half a millionth of a tile — is the slack a build summing the same steps in a
 * different order needs, and nothing more. Both comparisons are between routes the
 * same build searched over floors carrying the same footprints on the same tiles,
 * so a conformant build reads them identically. What the bound excludes is whole
 * tiles of detour: a mover the surge walks through reads the open corridor's own
 * length back.
 */
const LENGTH_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** `paths.left.length` with the scenery up and `subject` (if any) beside it. */
function leftRoute(subject: TowerType | null): number {
  startRun(h);
  poseIdleTower(h, PLAIN, SPAN_COL, SCENERY_ROW);
  if (subject !== null) poseTower(h, subject, SPAN_COL, SUBJECT_ROW);
  return h.snapshot().paths[ROUTE].length;
}

it("A mover walls the floor", async () => {
  const open = leftRoute(null);
  const plain = leftRoute(PLAIN);

  for (const mover of MOVERS) {
    const walled = leftRoute(mover);
    const blocked = blockedTiles(h.snapshot());
    await h.advance(1);
    captureStill(h, "wall");

    for (const tile of footprintTiles(SPAN_COL, SUBJECT_ROW, sizeOf(mover))) {
      assertContains(
        blocked,
        tile,
        `the tiles a ${mover} anchored at (${SPAN_COL}, ${SUBJECT_ROW}) blocks, ` +
          `which specs/towers.md makes all four of its footprint`,
      );
    }

    assertGreaterThan(
      walled,
      open,
      `the ${ROUTE} route's length with a ${mover} completing the span at ` +
        `column ${SPAN_COL}, against the ${open} it runs with those four tiles ` +
        `open`,
    );
    assertCloseTo(
      walled,
      plain,
      LENGTH_DIGITS,
      `the ${ROUTE} route's length with a ${mover} on those four tiles, ` +
        `against the ${plain} the same four tiles cost under an ${PLAIN}`,
    );
  }
});
