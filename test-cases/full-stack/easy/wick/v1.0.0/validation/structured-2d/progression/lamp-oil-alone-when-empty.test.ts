// Wick — progression/lamp-oil-alone-when-empty: an empty pool offers
// `LAMP_OIL_ID` alone.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/progression.md`, "The draw":
// "When the pool is empty the overlay offers exactly one item, `LAMP_OIL_ID`,
// which fills no slot", with `LAMP_OIL_ID` (`lamp-oil`).
//
// THE POSE. An isolated `playing` run with every weapon slot filled at
// `MAX_WEAPON_LEVEL` and every passive slot filled at that passive's own max
// level, which the pool rules of "The candidate pool" leave with nothing: no
// held item is below a maximum, and neither kind of slot is free. Every driver
// switch is off and the world is empty, so nothing changes the slots between
// the pose and the draw. A build that offers three of anything over an empty
// pool fails here.
//
// THE TOLERANCE. Exact: one list of ids.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { LAMP_OIL_ID } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";
import { saturate } from "./loadout";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("offers lamp-oil and nothing else when no candidate remains", async () => {
  isolate(h);
  saturate(h);

  const overlay = await openLevelUp(h, 1);
  await h.frameDraw();
  captureStill(h, "oil");

  assertEqual(overlay.screen, "levelup", "screen after the opening tick");
  assertLength(
    overlay.run.pool,
    0,
    "run.pool with every slot filled and every item maxed",
  );
  assertDeepEqual(
    overlay.run.offers,
    [LAMP_OIL_ID],
    "run.offers over an empty pool (specs/progression.md, The draw)",
  );
});
