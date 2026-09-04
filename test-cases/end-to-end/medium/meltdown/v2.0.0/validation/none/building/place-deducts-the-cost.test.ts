// building/place-deducts-the-cost — a placement costs exactly the type's build
// cost.
//
// specs/building.md, Placing: on the frame the preview is committed, "the money
// falls by exactly the type's build cost, and by nothing else".
//
// A FLAK IS PLACED RATHER THAN AN ARC because 60 is the figure specs/towers.md
// gives it and nothing else in this reading is 60: a build charging the level-II
// upgrade price, a refund-adjusted price, or one flat price for every tower reads
// a different balance, and the failure names the balance it left.
//
// THE PURSE IS POSED AT A ROUND FIGURE so the arithmetic in a failure is legible,
// and the balance is read on the frame the tower lands, with no frame run in
// between — "and by nothing else" is a claim about that frame, and a reading taken
// a second later would be measuring whatever else the run does with money.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TOWER_DEFS } from "../constants";
import { FREE_SITE } from "../fixtures";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { placeAt, requirePlaced } from "./preview";

/** The type placed and the cost specs/towers.md gives it. */
const HELD = "flak";
const COST = TOWER_DEFS[HELD].cost;

/** The purse the placement is paid out of. */
const PURSE = 500;

/** A quiet anchor: clear of every opening and of both corridors. */
const AT = FREE_SITE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("takes exactly the build cost out of the money", async () => {
  await startRun(h);
  await h.debug.setMoney(PURSE);

  const placed = await placeAt(h, HELD, AT.col, AT.row);
  const after = (await h.snapshot()).money;

  await h.advance(1);
  await captureStill(h, "cost");

  requirePlaced(placed, `a ${HELD} on open floor at (${AT.col}, ${AT.row})`);
  assertEqual(after, PURSE - COST, `the balance after placing a ${HELD}`);
});
