// materials/material-not-sold — the Ore Market does not take the satchel.
//
// `specs/mining.md` says exotic materials "are never sold", and
// `specs/gameplay.md` fixes what a sale does take: "Selling the cargo at each
// ore's value, which empties the bay." So the satchel is posed alongside a bay
// with ore in it, the sale is driven, and the satchel is read back unchanged
// while the bay empties.
//
// Both halves matter. The bay emptying is what proves the sale really happened,
// so a build whose `sell` does nothing at all fails here rather than passing by
// leaving everything alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  layCamp,
  openScene,
  pinDrill,
  stageCargo,
  standAtCamp,
  type Harness,
} from "../harness";

/** A bay worth selling, and a satchel carrying both materials with a spare. */
const CARGO = { ferron: 3, argenite: 1 } as const;
const RESONITE = 2;
const CRYENITE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the satchel untouched while the sale empties the bay", async () => {
  openScene(h);
  layCamp(h);
  standAtCamp(h);
  pinDrill(h);
  stageCargo(h, CARGO);
  h.debug.setMaterial("resonite", RESONITE);
  h.debug.setMaterial("cryenite", CRYENITE);
  h.debug.setCredits(0);
  h.debug.setPanel("ore-market");

  h.debug.sell();
  await h.advance(1);
  captureStill(h, "sale");

  const after = h.snapshot();
  assertEqual(after.satchel.resonite, RESONITE, "specs/mining.md");
  assertEqual(after.satchel.cryenite, CRYENITE, "specs/mining.md");
  assertEqual(after.satchel.coreSample, false, "specs/instrumentation.md");
  // The sale did happen, so the reading above is a satchel a sale passed over.
  assertEqual(after.cargo.slotsUsed, 0, "specs/gameplay.md");
  assertGreaterThan(after.credits, 0, "specs/gameplay.md");
});
