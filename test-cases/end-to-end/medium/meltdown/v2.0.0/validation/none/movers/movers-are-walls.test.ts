// Meltdown — movers/movers-are-walls: a mover walls the floor.
//
// `specs/towers.md` says it of both movers in one line: "Both block their four
// tiles like any other tower." `specs/mazing.md` says what blocking means — "A
// tower blocks every tile of its footprint from the frame it lands until the
// frame it leaves, whatever its size and whatever kind of tower it is. ... A
// blocked tile is not open floor: no surge route passes through one" — and
// `specs/instrumentation.md` makes the consequence observable: "a wall that
// lengthens a route shows up in its length", reported as `paths.left.length`.
//
// WHY THE CORRIDOR TAKES TWO FOOTPRINTS. `specs/floor.md` opens the left vent
// onto rows `16..19` and the right exhaust onto the same four rows, so the
// corridor between them is four tiles deep and a 2x2 footprint dropped on it
// leaves a straight lane open beside itself — correctly. Both movers are 2x2 at
// every level (`specs/towers.md`), so the span is made of two: a plain Arc holds
// the corridor's southern half in EVERY leg, and the tower under test takes the
// northern half. The Arc is scenery, identical in all four legs, and the only
// thing that changes between them is what stands on those four northern tiles.
//
// THE FOUR LEGS AND WHAT EACH DECIDES:
//
//   - nothing on them at all, which is the yardstick: the corridor is still open
//     along its northern rows and the route is the straight one;
//   - a plain Arc, which is what "exactly as an Arc does" is measured against;
//   - a Forge, and then a Sink.
//
// Each of the last three is asserted against the route length the metric gives
// for the blocked set THIS CHECK POSED, computed in `validation/none/routes.ts`
// from the footprint sizes `specs/towers.md` states — never from the `size` a
// snapshot reports, and never from a figure a reference produced. A build that
// walks the surge over a mover, or that blocks a mover's anchor tile alone,
// leaves the northern lane open and reads the yardstick back.
//
// A ROUTE'S TILE SEQUENCE IS NOT ASSERTED, and must not be: `specs/mazing.md`
// fixes no tie-break among equal-cost routes. What is asserted is the LENGTH, in
// the metric the specification states.
//
// The guns are held off throughout: walling is the only faculty this requirement
// exercises, and a firing line has no part in a route length.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { LEFT_VENT_ROWS, type TowerType } from "../constants";
import {
  captureStill,
  createHarness,
  poseIdleTower,
  poseTower,
  startRun,
  type Harness,
} from "../harness";
import { blockedSet, routeLength } from "../routes";
import { SLOT } from "./contact";

/** The tower type the yardstick leg is measured against. */
const PLAIN: TowerType = "arc";

/** The two movers, each of which must wall exactly as the Arc does. */
const MOVERS: readonly TowerType[] = ["forge", "sink"];

/**
 * Where the span goes: ten tiles into the floor, on the left corridor.
 *
 * The scenery Arc is anchored on the corridor's third row so its 2x2 footprint
 * covers rows `18..19`, and the tower under test on its first row so its
 * footprint covers rows `16..17`. Together they span the corridor's whole
 * four-row run at columns `10..11` (`specs/floor.md`).
 */
const SPAN_COL = 10;
const SCENERY_ROW = LEFT_VENT_ROWS[SLOT];
const SUBJECT_ROW = LEFT_VENT_ROWS[0];

/** The scenery half of the span, identical in every leg. */
const SCENERY = { type: PLAIN, col: SPAN_COL, row: SCENERY_ROW } as const;

/** What the metric gives for the corridor spanned by a 2x2 under test. */
const SPANNED_ROUTE = routeLength(
  blockedSet([SCENERY, { type: PLAIN, col: SPAN_COL, row: SUBJECT_ROW }]),
  "left",
);

/**
 * How far the reported length may sit from the computed one, in tiles.
 *
 * The metric is a sum of `1`s and `sqrt(2)`s (`specs/mazing.md`), so a build
 * summing it in a different order differs in the last bits of a double and
 * nothing more. The bound is set instead by what has to stay separated: the
 * spanned route and the open one, which the corridor's detour puts a whole tile
 * apart, so a hundredth of a tile keeps a build that walls the floor apart from
 * one that lets the surge through a mover.
 */
const TOLERANCE = 0.01;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** `paths.left.length` with the scenery up and `subject` (if any) beside it. */
async function leftRoute(subject: TowerType | null): Promise<number> {
  await startRun(h);
  await poseIdleTower(h, SCENERY.type, SCENERY.col, SCENERY.row);
  if (subject !== null) {
    await poseTower(h, subject, SPAN_COL, SUBJECT_ROW);
  }
  await h.advance(1);
  return (await h.snapshot()).paths.left.length;
}

it("A mover walls the floor", async () => {
  const open = await leftRoute(null);
  const plain = await leftRoute(PLAIN);

  assertLessThanOrEqual(
    Math.abs(plain - SPANNED_ROUTE),
    TOLERANCE,
    `the cheapest left route round a corridor spanned by two 2x2 footprints ` +
      `at column ${SPAN_COL} is ${SPANNED_ROUTE.toFixed(4)} tiles ` +
      `(specs/mazing.md); with a plain ${PLAIN} on the northern half the ` +
      `build reported ${plain.toFixed(4)}, off by`,
  );

  for (const mover of MOVERS) {
    const walled = await leftRoute(mover);
    await captureStill(h, "wall");

    assertGreaterThan(
      walled,
      open + TOLERANCE,
      `a ${mover} completing the span at column ${SPAN_COL} lengthens the ` +
        `left route past the ${open.toFixed(4)} it stood at with those four ` +
        `tiles open; the length reported with the ${mover} up was`,
    );
    assertLessThanOrEqual(
      Math.abs(walled - SPANNED_ROUTE),
      TOLERANCE,
      `a ${mover} blocks its four tiles exactly as an ${PLAIN} does, so the ` +
        `route round it is the same ${SPANNED_ROUTE.toFixed(4)} tiles; the ` +
        `build reported ${walled.toFixed(4)}, off by`,
    );
    assertLessThanOrEqual(
      Math.abs(walled - plain),
      TOLERANCE,
      `the left route with a ${mover} on those four tiles against the ` +
        `${plain.toFixed(4)} the same four tiles gave under an ${PLAIN}, ` +
        "apart by",
    );
  }
});
