// drilling/ore-banks — breaking an ore cell banks a unit into cargo.
//
// specs/mining.md: drilling an ore cell removes it and banks one unit of that
// ore into the cargo bay when a slot is free. One unit fills one slot whatever
// its weight, and the weight it carries is the ore's own, from the table that
// file prints. specs/character.md adds that the broken cell becomes open tunnel
// like any other.
//
// The bay opens empty and the cargo tier opens at `1`, whose capacity is `15`, so
// there is a free slot and the full-bay path is the sibling check's. The ore is
// Cuprite, whose weight (`18`) is shared by no other mineral, so the load read
// back names which ore was banked rather than merely that something was.

import { afterEach, beforeEach, it } from "vitest";
import { CARGO_TIERS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  driveCut,
  layOre,
  mineralOf,
  openScene,
  pinMiner,
  standOn,
  type Harness,
} from "../harness";

/** A column and a row well clear of the camp, the cave mouth, and the Core. */
const COL = 8;
const ROW = 12;

/** The ore posed: its weight is shared by no other mineral or gemstone. */
const ORE = "cuprite";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("banks one unit of the ore the broken cell held", async () => {
  openScene(h);
  layOre(h, COL, ROW, ORE);
  standOn(h, COL, ROW);
  pinMiner(h);

  const opening = h.snapshot();
  assertEqual(opening.cargo.slotsUsed, 0, "specs/expedition.md");
  assertEqual(opening.cargo.slotCap, CARGO_TIERS[0], "specs/upgrades.md");
  assertEqual(h.tileAt(COL, ROW).ore, ORE, "specs/instrumentation.md");

  const cut = await captureReplay(h, "collect", () =>
    driveCut(h, "down", { col: COL, row: ROW }),
  );

  assertEqual(cut.broke, true, "specs/character.md");
  assertEqual(cut.tile.kind, "tunnel", "specs/character.md");
  assertEqual(cut.snapshot.cargo.ore[ORE], 1, "specs/mining.md");
  assertEqual(cut.snapshot.cargo.slotsUsed, 1, "specs/mining.md");
  assertEqual(
    cut.snapshot.cargo.loadKg,
    mineralOf(ORE).weightKg,
    "specs/mining.md",
  );
});
