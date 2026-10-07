// Meltdown — screens/mode-select-lists-its-rows: the mode list draws every row of
// MODE_ITEMS.
//
// THE RULE. `specs/screens.md`, on `modeselect`: it "Draws the six rows of
// `MODE_ITEMS`: `CONTAINMENT`, `THE HUNDRED`, `DEEP POCKETS`, `BOTTLENECK`,
// `SUDDEN DEATH`, and `BACK`." All five modes, because `specs/modes.md` makes all
// five playable and a mode a player cannot see is a mode a player cannot choose;
// and `BACK` with them, because a row a player cannot see is a row a finger cannot
// find, and it is the list's only way out on a touchscreen.
//
// EACH NAME IS ASSERTED SEPARATELY, so a build that drew five of the six fails with
// the missing one named rather than with "the list is wrong".
//
// MATCHED BY SUBSTRING, because the words are the case's and the presentation is
// the build's: a row is commonly drawn with a marker, a number or padding beside it,
// and requiring the exact run would fail a list showing precisely the right names.
//
// THE SCREEN IS POSED, because what the list DRAWS does not depend on how a player
// got to it. Where each row leads is `screens.containment-opens-difficulty-select`'s
// and `screens.special-mode-starts-immediately`'s; whether each row's description is
// readable is `screens.mode-descriptions-before-choosing`'s.
//
// THE HIGHLIGHT IS LEFT WHERE `reset` PUTS IT, on row `0`, because every row must be
// drawn whichever one is highlighted — a build that drew only the highlighted row's
// name would fail here on the other four.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { MODE_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { drewText } from "../case-harness/index";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws all five mode names on the mode list", async () => {
  const { debug } = h;
  await debug.reset();
  await debug.setScreen("modeselect");

  const calls = await h.frameCalls();
  await captureStill(h, "modes");

  assertEqual(
    (await h.snapshot()).screen,
    "modeselect",
    "the screen the list is read on",
  );
  for (const [row, item] of MODE_ITEMS.entries()) {
    assertEqual(
      drewText(calls, item),
      true,
      `the mode list drew ${item}, row ${row} of ${MODE_ITEMS.length}`,
    );
  }
});
