// Meltdown — building/sell-clears-the-selection — selling the selected tower deselects.
//
// specs/building.md, Selling: "the selection is cleared when the tower sold was
// the selected one." specs/building.md, Selecting, is where the field's shape
// comes from: "Selecting is by tower: one tower is selected at a time, or none."
//
// ONE DIRECTION, BECAUSE THE OTHER IS ITS OWN POINT. A build that clears the
// selection on EVERY sale satisfies this one and is exactly as wrong as one that
// never clears it, so the second direction — selling a tower that was NOT selected
// leaves the selection alone — is `building.sell-another-keeps-the-selection`'s,
// and the two verdicts between them name which of the two wrong builds was
// written.
//
// THE TOWER IS POSED WITH `poseTower`, the atom, on a quiet anchor, so the
// requirement here is what a SALE does to the selection and nothing about how the
// tower got onto the floor is being graded.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  poseTower,
  startRun,
  type Harness,
} from "../harness";
import { freeSite } from "./sites";

/** The tower sold, on a quiet anchor. */
const HELD = "arc";
const SITE = freeSite(0);

/** Enough money that nothing here is about affordability. */
const PURSE = 200;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("clears the selection on selling the selected tower", async () => {
  startRun(h);
  h.debug.setMoney(PURSE);
  const id = poseTower(h, HELD, SITE.col, SITE.row);

  h.debug.setSelected(id);
  assertEqual(h.snapshot().selected, id, "the tower the scenario selected");

  h.debug.sellTower(id);
  const after = h.snapshot();

  await h.advance(1);
  captureStill(h, "deselected");

  assertNull(after.selected, "the selection after selling the selected tower");
});
