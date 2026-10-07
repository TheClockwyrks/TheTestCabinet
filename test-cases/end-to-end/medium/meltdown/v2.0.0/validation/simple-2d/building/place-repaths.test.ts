// building/place-repaths — the routes are recomputed on the frame a tower lands.
//
// specs/building.md, Placing: "Every tile of the footprint becomes blocked, and the
// routes are recomputed." specs/mazing.md, Live re-pathing: "Every route is
// recomputed on the frame the set of blocked tiles changes: a tower placed, a
// tower sold, or a tower otherwise added to or removed from the floor."
//
// WHAT IS PLACED, AND WHY IT HAS TO LENGTHEN THE LEFT ROUTE. The left vent opens
// onto rows 16 to 19 and the right exhaust onto the same four rows
// (specs/floor.md, The openings), and `paths.left.length` is the cheapest route
// between them (specs/mazing.md, The route and its length). A 4x4 Lance is exactly
// four tiles on a side, so one anchored at the first of those rows blocks all four
// of them across its four columns and no route may run straight along any of them
// any more. Every remaining route has to leave the band and come back, and the
// diagonal that would cut the corner is not a step either — a diagonal is only a
// step when both orthogonal tiles it cuts past are open (specs/mazing.md), and one
// of them is the wall — so the detour costs strictly more than the straight run it
// replaces.
//
// THE CHECK ASSERTS THAT INCREASE RATHER THAN A PARTICULAR NEW LENGTH. The
// specification fixes the route as the cheapest one under its step rule and states
// in as many words that nothing fixes which of several equal-cost routes a unit
// takes, so the honest reading of "recomputed" is that the figure moved in the
// direction the wall forces and stayed finite. A build that never re-paths reports
// the empty floor's length and fails. What a particular maze measures to is
// `mazing`'s business, not this item's.
//
// THE READING IS TAKEN WITH NO FRAME ADVANCED between the placement and the
// snapshot, which is what makes it a reading about the frame the tower lands on.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { placeAt, requirePlaced } from "./preview";
import { CORRIDOR_ROWS, WALL_COL, WALL_ROW } from "./sites";

/** The 4x4 tower that walls the left corridor, clear of the vent and the exhaust. */
const HELD = "lance";

/** Enough money that affordability is never what refuses the placement. */
const PURSE = 1000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("recomputes the left route on the frame the tower lands", async () => {
  startRun(h);
  h.debug.setMoney(PURSE);

  const before = h.snapshot().paths.left.length;
  assertTrue(
    Number.isFinite(before),
    "the left route's length on an empty floor",
  );

  const placed = placeAt(h, HELD, WALL_COL, WALL_ROW);
  const after = h.snapshot().paths.left.length;

  await h.advance(1);
  captureStill(h, "repathed");

  requirePlaced(
    placed,
    `a ${HELD} across the left corridor at column ${WALL_COL}`,
  );
  assertTrue(
    Number.isFinite(after),
    "the left route's length once the wall is up",
  );
  assertGreaterThan(
    after,
    before,
    `the left route's length once a ${HELD} walls rows ${CORRIDOR_ROWS} at ` +
      `column ${WALL_COL}, against the ${before} the open corridor measured`,
  );
});
