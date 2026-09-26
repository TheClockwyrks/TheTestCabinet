// materials/material-takes-no-slot — a material uses no slot of the cargo bay.
//
// `specs/mining.md` keeps the satchel and the cargo bay apart: "Exotic materials
// are not cargo: they take no slot, carry no weight, and ride in a separate
// satchel."
//
// TWO CLAIMS, TWO POINTS. A slot and a kilogram are separate things a build
// tracks separately, so a build whose materials take no slot and DO weigh
// something must grade differently from one that gets both wrong. The other half
// is `materials/material-carries-no-weight`.
//
// THE SLOT. `specs/mining.md` gives the bay a fixed number of slots, so a
// material that consumed one would cost a haul the ore it could have carried.
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

afterEach(() => {
  h?.dispose();
});

it("leaves the slots used exactly as an empty bay leaves them", async () => {
  openScene(h);
  layCamp(h);
  standAtCamp(h);
  pinDrill(h);
  h.debug.clearCargo();

  const empty = h.snapshot();
  assertEqual(empty.cargo.slotsUsed, 0, "specs/mining.md");

  h.debug.setMaterial("resonite", RESONITE);
  h.debug.setMaterial("cryenite", CRYENITE);
  await h.advance(1);
  captureStill(h, "satchel");

  const held = h.snapshot();
  assertEqual(held.satchel.resonite, RESONITE, "specs/instrumentation.md");
  assertEqual(held.satchel.cryenite, CRYENITE, "specs/instrumentation.md");
  assertEqual(held.cargo.slotsUsed, empty.cargo.slotsUsed, "specs/mining.md");
});
