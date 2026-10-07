// Meltdown — movers/movers-are-walls: a mover walls the floor.
//
// specs/towers.md ends the Forge and the Sink's entry with "Both block their four
// tiles like any other tower", and specs/mazing.md makes every tower a wall the
// surge routes around, reporting the cheapest vent-to-exhaust route as
// `paths.left.length` and `paths.top.length`. A mover is not an exception to
// either: it is a 2x2 obstacle that lengthens a route exactly as a 2x2 emitter
// standing on the same four tiles would.
//
// WHY THE FLOOR NEEDS A MAZE FIRST. Four blocked tiles dropped on an open floor
// change nothing a route cannot absorb: the left vent and the right exhaust are
// four rows tall each (specs/floor.md), so the surge simply walks a row over and
// the reported length does not move. A check that measured that would report a
// mover blocking nothing and a mover blocking everything as the same number. So a
// barrier is laid down first — 2x2 towers filling columns `24` and `25` from the
// north casing down to row `25`, leaving one gap from row `26` to the floor's
// southern edge — and the route is forced through the gap. THE TOWER UNDER TEST
// PLUGS THE TOP TWO ROWS OF THAT GAP, so a floor on which it blocks its tiles has a
// measurably deeper detour than one on which it does not, and the gap is left four
// rows wide underneath it so the floor is never sealed (specs/mazing.md).
//
// THREE READINGS, EACH DECIDING SOMETHING DIFFERENT.
//
//   - THE PLUG LENGTHENS THE ROUTE AT ALL. Held against the barrier alone, so a
//     build whose movers are walked straight through fails on the first reading.
//   - IT LENGTHENS IT EXACTLY AS AN ARC DOES. The same barrier, the same anchor,
//     an Arc in the Forge's place. This is the item's own claim, and it catches a
//     build that blocks a mover's tiles but counts its footprint wrongly — a mover
//     treated as a single tile, or as a 3x3.
//   - IT IS THE LENGTH THE SPECIFICATION'S OWN SEARCH FINDS. `routes.ts` re-runs
//     specs/mazing.md's step rule over the same floor from the case's own figures,
//     so what the build reports is held against a route length nothing of the
//     build's computed. A build that agrees with itself about the wrong answer is
//     caught here rather than passing.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  poseTower,
  startRun,
  type Harness,
  type TowerType,
} from "../harness";
import { ventRouteLength } from "../routes";

/** The mover read, and the emitter its blocking is held against. */
const MOVER: TowerType = "forge";
const EMITTER: TowerType = "arc";

/** The route read: the left vent's, to its fixed opposite exhaust. */
const ROUTE = "left";

/**
 * The barrier, as geometry. It fills columns `24` and `25` with 2x2 footprints
 * anchored on rows `0` through `24`, so it runs from the north casing to row `25`
 * and leaves rows `26` to `35` open.
 */
const BARRIER_COL = 24;
const BARRIER_ROWS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24] as const;

/** Where the tower under test stands: the top two rows of the gap. */
const PLUG_ROW = 26;

/**
 * How close two route lengths must come, as decimal places of a tile.
 *
 * A route length is a sum of `1`s and `sqrt(2)`s (specs/mazing.md), so six places
 * — half a millionth of a tile — is floating-point slack and nothing more. Both
 * comparisons are between routes over the same floor, and the differences this
 * item exists to name are whole tiles: a mover that blocks nothing reads `1.66`
 * short, and one whose footprint is counted as a single tile reads shorter still.
 */
const LENGTH_DIGITS = 6;

/** Lay the barrier down on an already-opened run. */
function poseBarrier(h: Harness): void {
  for (const row of BARRIER_ROWS) poseTower(h, EMITTER, BARRIER_COL, row);
}

/** Open a run, lay the barrier, and plug the gap with `plug` if one is named. */
function poseFloor(h: Harness, plug: TowerType | null): void {
  startRun(h);
  poseBarrier(h);
  if (plug !== null) poseTower(h, plug, BARRIER_COL, PLUG_ROW);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("A mover walls the floor", async () => {
  poseFloor(h, null);
  const open = h.snapshot().paths[ROUTE].length;

  poseFloor(h, EMITTER);
  const walled = h.snapshot().paths[ROUTE].length;

  poseFloor(h, MOVER);
  const moved = h.snapshot();
  const blocked = moved.paths[ROUTE].length;
  await h.advance(1);
  captureStill(h, "wall");

  assertGreaterThan(
    blocked,
    open,
    `the ${ROUTE} route's length with a ${MOVER} plugging the gap at ` +
      `(${BARRIER_COL}, ${PLUG_ROW}), against the ${open} it runs with the gap ` +
      `open`,
  );
  assertCloseTo(
    blocked,
    walled,
    LENGTH_DIGITS,
    `the ${ROUTE} route's length with a ${MOVER} on those four tiles, against ` +
      `the ${walled} the same four tiles cost under an ${EMITTER}`,
  );
  assertCloseTo(
    blocked,
    ventRouteLength(moved.towers, ROUTE),
    LENGTH_DIGITS,
    `the ${ROUTE} route's length the build reports with a ${MOVER} plugging ` +
      `the gap, against the cheapest route specs/mazing.md's own step rule finds ` +
      `over the same floor`,
  );
});
