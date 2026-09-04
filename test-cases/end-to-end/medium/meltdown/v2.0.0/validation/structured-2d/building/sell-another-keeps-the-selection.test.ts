// Meltdown — building/sell-another-keeps-the-selection — selling a tower that is not the
// selected one leaves the selection where it was.
//
// specs/building.md, Selling: "Selling a tower that was not selected leaves the
// selection where it was." specs/building.md, Selecting, is where the field's
// shape comes from: "Selecting is by tower: one tower is selected at a time, or
// none."
//
// ONE DIRECTION, BECAUSE THE OTHER IS ITS OWN POINT. A build that never clears the
// selection satisfies this one and is exactly as wrong as one that clears it on
// every sale, so the other direction — selling the SELECTED tower clears it — is
// `building.sell-clears-the-selection`'s, and the two verdicts between them name
// which of the two wrong builds was written.
//
// TWO TOWERS ARE POSED WITH `poseTower`, the atom, on quiet anchors six tiles
// apart, so neither is on a corridor and neither touches the other: the
// requirement here is what a sale of ANOTHER tower does to the selection, and
// nothing about how either got onto the floor is being graded. The one that stays
// is the selected one, so the reading afterwards is that the same id is still
// selected rather than merely that something is.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseTower,
  startRun,
  type Harness,
} from "../harness";
import { freeSite } from "./sites";

/** The two towers, on quiet anchors six tiles apart. */
const HELD = "arc";
const SOLD = freeSite(0);
const KEPT = freeSite(1);

/** Enough money that nothing here is about affordability. */
const PURSE = 200;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the selection alone on selling another tower", async () => {
  startRun(h);
  h.debug.setMoney(PURSE);
  const sold = poseTower(h, HELD, SOLD.col, SOLD.row);
  const kept = poseTower(h, HELD, KEPT.col, KEPT.row);

  h.debug.setSelected(kept);
  assertEqual(h.snapshot().selected, kept, "the tower the scenario selected");

  h.debug.sellTower(sold);
  const after = h.snapshot();

  await h.advance(1);
  captureStill(h, "kept");

  assertEqual(
    after.selected,
    kept,
    "the selection after selling the tower that was NOT selected",
  );
});
