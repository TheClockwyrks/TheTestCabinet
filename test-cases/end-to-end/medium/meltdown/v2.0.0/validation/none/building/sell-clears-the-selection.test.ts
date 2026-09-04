// building/sell-clears-the-selection — selling the selected tower deselects, and
// selling a different one leaves the selection where it was.
//
// specs/building.md, Selling: "the selection is cleared when the tower sold was the
// selected one. Selling a tower that was not selected leaves the selection where it
// was." specs/building.md, Selecting, is where the field's shape comes from:
// "Selecting is by tower: one tower is selected at a time, or none."
//
// TWO CLAUSES, AND BOTH HAVE TO BE READ, because a build that clears the selection on
// EVERY sale satisfies the first on its own and is exactly as wrong as one that never
// clears it. So two towers stand on the floor and B is selected throughout: selling A
// must leave B selected, and selling B must leave nothing selected. Between them the
// two readings name which of the two wrong builds was written — a build that always
// clears fails the first, one that never clears fails the second.
//
// THE ORDER IS DELIBERATE. The sale that must NOT disturb the selection comes first,
// while there is still another tower to sell; taking them the other way round would
// leave nothing to make the second reading on.
//
// THE TWO TOWERS ARE POSED WITH `poseTower`, the atom, and stand on quiet anchors six
// tiles apart, so neither is on a corridor and neither touches the other: the
// requirement here is what a SALE does to the selection, and nothing about how either
// tower got onto the floor is being graded.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { freeSite } from "../fixtures";
import {
  captureStill,
  createHarness,
  poseTower,
  startRun,
  type Harness,
} from "../harness";

/** The two towers, on quiet anchors six tiles apart. */
const HELD = "arc";
const FIRST = freeSite(0);
const SECOND = freeSite(1);

/** Enough money that nothing here is about affordability. */
const PURSE = 200;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("clears the selection on selling the selected tower and leaves it on selling another", async () => {
  await startRun(h);
  await h.debug.setMoney(PURSE);
  const a = await poseTower(h, HELD, FIRST.col, FIRST.row);
  const b = await poseTower(h, HELD, SECOND.col, SECOND.row);

  await h.debug.setSelected(b);
  assertEqual(
    (await h.snapshot()).selected,
    b,
    "the tower the scenario selected",
  );

  // Selling a tower that was not the selected one.
  await h.debug.sellTower(a);
  assertEqual(
    (await h.snapshot()).selected,
    b,
    "the selection after selling the tower that was NOT selected",
  );

  // Selling the selected one.
  await h.debug.sellTower(b);
  const after = await h.snapshot();

  await h.advance(1);
  await captureStill(h, "deselected");

  assertNull(after.selected, "the selection after selling the selected tower");
});
