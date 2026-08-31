// building/place-repaths — the routes are recomputed on the frame a tower lands.
//
// specs/building.md, Placing: "Every tile of the footprint becomes blocked, and
// the routes are recomputed." specs/mazing.md, Live re-pathing: "Every route is
// recomputed on the frame the set of blocked tiles changes: a tower placed, a
// tower sold, or a tower otherwise added to or removed from the floor."
//
// WHAT IS PLACED, AND WHY IT HAS TO LENGTHEN THE LEFT ROUTE. The left vent opens
// onto rows 16 to 19 and the right exhaust onto the same four rows
// (specs/floor.md, The openings), and `paths.left.length` is the cheapest route
// between them (specs/mazing.md, The route and its length). A 4x4 Lance is
// exactly four tiles on a side, so one anchored at row 16 blocks all four of
// those rows across its four columns and no route may run straight along any of
// them any more. Every remaining route has to leave the band and come back, which
// costs more than the straight run it replaces, so the recomputed length is
// strictly greater than the one the empty floor had.
//
// The check asserts that increase rather than a particular new length: the
// specification fixes the route as the cheapest one under its step rule and does
// not fix which of several equal-cost routes is taken, so the honest reading of
// "recomputed" is that the figure moved and stayed finite. A build that never
// re-paths reports the empty floor's length and fails.
//
// The reading is taken with no frame advanced between the placement and the
// snapshot, which is what makes it a reading about the frame the tower lands on.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertNotNull, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  placeAt,
  startRun,
  type Harness,
} from "../harness";

/** The 4x4 tower, anchored on the first row of the left vent's band. */
const HELD = "lance";
const COL = 24;
const ROW = 16;

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

  const id = placeAt(h, HELD, COL, ROW);
  const after = h.snapshot().paths.left.length;

  await h.advance(1);
  captureStill(h, "repathed");

  assertNotNull(id, "the tower a valid placement built");
  assertTrue(
    Number.isFinite(after),
    "the left route's length once the wall is up",
  );
  assertGreaterThan(
    after,
    before,
    `the left route's length once a ${HELD} walls rows 16-19 at column ${COL}`,
  );
});
