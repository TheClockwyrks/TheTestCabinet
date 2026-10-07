// building/preview-invalid-when-unaffordable — one coin short of the build cost
// makes the footprint invalid.
//
// specs/building.md, Valid and invalid, condition 4: "The current money is at
// least the held type's build cost." AT LEAST, so exactly the cost buys it and one
// below it does not.
//
// THE MONEY IS THE ONLY THING THAT MOVES. The same footprint is read twice: once
// with the purse at exactly the Arc's cost, where every one of the six conditions
// holds and it must read valid, and once with the purse one coin lower, where only
// condition 4 has changed. That pair is what tells a build with the boundary on
// the wrong side of `>=` from a build that reports invalid whatever it is asked,
// and it names which of the two it is.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TOWER_DEFS } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { probeValid } from "./preview";
import { FREE_SITE } from "./sites";

/** The type read, and the cost specs/towers.md gives the Arc. */
const HELD = "arc";
const COST = TOWER_DEFS[HELD].cost;

/** A quiet anchor, so only the money can fail the footprint. */
const AT = FREE_SITE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads the footprint invalid with the money one coin below the cost", async () => {
  startRun(h);

  h.debug.setMoney(COST);
  assertEqual(
    probeValid(h, HELD, AT.col, AT.row),
    true,
    `the ${HELD} footprint with the money at its cost, ${COST}`,
  );

  h.debug.setMoney(COST - 1);
  const short = probeValid(h, HELD, AT.col, AT.row);

  await h.advance(1);
  captureStill(h, "invalid");

  assertEqual(
    short,
    false,
    `the ${HELD} footprint with the money at ${COST - 1}, one below its cost`,
  );
});
