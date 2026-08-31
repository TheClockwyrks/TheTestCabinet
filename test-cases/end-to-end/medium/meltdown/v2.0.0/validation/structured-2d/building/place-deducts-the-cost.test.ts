// building/place-deducts-the-cost — a placement costs exactly the type's build
// cost.
//
// specs/building.md, Placing: on the frame the preview is committed, "the money
// falls by exactly the type's build cost, and by nothing else".
//
// A Flak is placed rather than an Arc because 60 is the figure specs/towers.md
// gives it and nothing else in this reading is 60: a build charging the upgrade
// price, a refund-adjusted price, or a flat price reads a different balance, and
// the failure names the balance it left.
//
// The purse is posed at a round figure so the arithmetic in a failure is legible,
// and the balance is read on the frame the tower lands, before any frame runs.

import { afterEach, beforeEach, it } from "vitest";
import { TOWER_DEFS } from "../../src/constants";
import { assertEqual, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  placeAt,
  startRun,
  type Harness,
} from "../harness";

/** The type placed and the cost specs/towers.md gives it. */
const HELD = "flak";
const COST = TOWER_DEFS[HELD].cost;

/** The purse the placement is paid out of. */
const PURSE = 500;

/** Open floor clear of the four openings. */
const COL = 10;
const ROW = 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes exactly the build cost out of the money", async () => {
  startRun(h);
  h.debug.setMoney(PURSE);

  const id = placeAt(h, HELD, COL, ROW);
  const after = h.snapshot().money;

  await h.advance(1);
  captureStill(h, "cost");

  assertNotNull(id, "the tower a valid placement built");
  assertEqual(after, PURSE - COST, `the balance after placing a ${HELD}`);
});
