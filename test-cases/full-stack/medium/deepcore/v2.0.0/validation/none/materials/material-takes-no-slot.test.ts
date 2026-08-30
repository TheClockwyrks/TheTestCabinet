// materials/material-takes-no-slot — the satchel is not the cargo bay.
//
// `specs/mining.md` keeps the two apart: "Exotic materials are not cargo: they
// take no slot, carry no weight, and ride in a separate satchel." What that buys
// a player is fixed by `specs/character.md`, where the load fraction is
// `loadKg / liftLimitKg` and a fraction of `1` is the overload wall the jetpack
// cannot lift past. So a satchel carrying both materials, spares included, must
// leave `slotsUsed`, `loadKg` and `overloaded` exactly where an empty bay leaves
// them.
//
// The bay is emptied first and read before the materials are banked, so the
// second reading is held against the first rather than against an assumption
// about what an empty bay reports.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  layCamp,
  openScene,
  pinDrill,
  standAtCamp,
  type Harness,
} from "../harness";

/** Both materials held, each with a spare, so the reading covers more than one. */
const RESONITE = 3;
const CRYENITE = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the slots, the load and the overload flag as an empty bay leaves them", async () => {
  await openScene(h);
  await layCamp(h);
  await standAtCamp(h);
  await pinDrill(h);
  await h.debug.clearCargo();

  const empty = await h.snapshot();
  assertEqual(empty.cargo.slotsUsed, 0, "specs/mining.md");
  assertEqual(empty.cargo.loadKg, 0, "specs/mining.md");

  await h.debug.setMaterial("resonite", RESONITE);
  await h.debug.setMaterial("cryenite", CRYENITE);
  await h.advance(1);
  await captureStill(h, "satchel");

  const held = await h.snapshot();
  assertEqual(held.satchel.resonite, RESONITE, "specs/instrumentation.md");
  assertEqual(held.satchel.cryenite, CRYENITE, "specs/instrumentation.md");
  assertEqual(held.cargo.slotsUsed, empty.cargo.slotsUsed, "specs/mining.md");
  assertEqual(held.cargo.loadKg, empty.cargo.loadKg, "specs/mining.md");
  assertEqual(held.miner.overloaded, false, "specs/character.md");
});
