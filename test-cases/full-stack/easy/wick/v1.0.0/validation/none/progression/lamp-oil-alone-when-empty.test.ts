// progression/lamp-oil-alone-when-empty — an empty pool offers lamp-oil alone.
//
// WHERE THE THRESHOLD COMES FROM. specs/progression.md ("The draw"): "When the
// pool is empty the overlay offers exactly one item, `LAMP_OIL_ID`, which fills
// no slot", with "The fallback offer's id | `LAMP_OIL_ID` | `lamp-oil`".
// specs/instrumentation.md reports it as the one exception to the subset rule:
// "`offers` is a subset of it except for the lamp-oil offer over an empty pool".
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with every faculty held
// and nothing alive, over the one loadout that empties the pool: both slot kinds
// full, so no new item is a candidate, and every held item at its own max, so no
// `+1` is one either. Both halves are needed — a full loadout below its maxima
// still offers levels, and a maxed loadout with a slot free still offers new
// items — so this is the only arrangement in which the fallback is reachable.
//
// THE TOLERANCE. None: the pool is empty or it is not, and the offers are one
// exact id or they are not.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { LAMP_OIL_ID } from "../constants";
import {
  captureStill,
  createHarness,
  openLevelUp,
  type Harness,
} from "../harness";
import { poseEmptyPool } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("presents lamp-oil and nothing else over an empty pool", async () => {
  await poseEmptyPool(h);

  const overlay = await openLevelUp(h);
  await captureStill(h, "oil");

  assertEqual(
    overlay.screen,
    "levelup",
    "the screen the queued level-up opened",
  );
  assertDeepEqual(
    overlay.run.pool,
    [],
    "the candidate pool over a full loadout at its maxima",
  );
  assertDeepEqual(
    overlay.run.offers,
    [LAMP_OIL_ID],
    "the offers presented over an empty pool",
  );
});
