// Meltdown — screens/mode-select-lists-five: the mode list draws every row of
// MODE_ITEMS.
//
// THE RULE. specs/screens.md, `modeselect`: "Draws the six rows of `MODE_ITEMS`:
// `CONTAINMENT`, `THE HUNDRED`, `DEEP POCKETS`, `BOTTLENECK`, `SUDDEN DEATH`, and
// `BACK`."
//
// ONE READING PER ROW OF ONE REQUIREMENT: each name is looked for as a run of
// text, and the failure names the one the build did not draw. A build that lists
// four modes leaves a mode a player can never choose, and a build that omits
// `BACK` leaves a touchscreen player no way off the list, so drawing every row is
// the requirement rather than drawing several.
//
// THE NAMES COME OFF `MODE_ITEMS`, the seeded constant, rather than being written
// out here — the check asks for the copy the case handed the build.
//
// WHERE THEY SIT IS THE BUILD'S. specs/screens.md fixes "a vertical list of rows"
// and no more, so nothing here reads a position, an order or a spacing. That a
// row's own DESCRIPTION is readable before it is chosen is
// `screens.mode-descriptions-before-choosing`, and where each row leads is
// `screens.containment-opens-difficulty-select` and
// `screens.special-mode-starts-immediately`.
//
// THE SCREEN IS POSED OUTRIGHT after a reset, so this reads the mode list itself
// rather than the route that reaches it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { MODE_ITEMS } from "../constants";
import { captureStill, createHarness, resetTo, type Harness } from "../harness";
import { readScreen, requireRun } from "./menu";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws every one of the five mode names on the mode list", async () => {
  resetTo(h);
  h.debug.setScreen("modeselect");
  h.debug.setMenuIndex(0);

  const runs = await readScreen(h);
  captureStill(h, "modes");

  assertEqual(
    h.snapshot().screen,
    "modeselect",
    "the screen the scenario is posed on",
  );
  for (const item of MODE_ITEMS) {
    requireRun(runs, item, "the mode list");
  }
});
