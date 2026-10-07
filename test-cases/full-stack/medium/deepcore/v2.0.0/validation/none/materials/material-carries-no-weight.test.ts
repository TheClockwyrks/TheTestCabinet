// materials/material-carries-no-weight — a material adds nothing to what the miner is carrying.
//
// `specs/mining.md` keeps the satchel and the cargo bay apart: "Exotic materials
// are not cargo: they take no slot, carry no weight, and ride in a separate
// satchel."
//
// TWO CLAIMS, TWO POINTS. A slot and a kilogram are separate things a build
// tracks separately, so a build whose materials take no slot and DO weigh
// something must grade differently from one that gets both wrong. The other half
// is `materials/material-takes-no-slot`.
//
// THE WEIGHT. `specs/character.md` makes the load fraction `loadKg /
// liftLimitKg` and a fraction of `1` the overload wall the jetpack cannot lift
// past, so a material that weighed something could strand a miner underground.
// Both `loadKg` and the `overloaded` flag it drives are read, which is the same
// figure at its source and at the wall it decides.
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

it("leaves the load and the overload flag as an empty bay leaves them", async () => {
  await openScene(h);
  await layCamp(h);
  await standAtCamp(h);
  await pinDrill(h);
  await h.debug.clearCargo();

  const empty = await h.snapshot();
  assertEqual(empty.cargo.loadKg, 0, "specs/mining.md");

  await h.debug.setMaterial("resonite", RESONITE);
  await h.debug.setMaterial("cryenite", CRYENITE);
  await h.advance(1);
  await captureStill(h, "satchel");

  const held = await h.snapshot();
  assertEqual(held.satchel.resonite, RESONITE, "specs/instrumentation.md");
  assertEqual(held.satchel.cryenite, CRYENITE, "specs/instrumentation.md");
  assertEqual(held.cargo.loadKg, empty.cargo.loadKg, "specs/mining.md");
  assertEqual(held.miner.overloaded, false, "specs/character.md");
});
