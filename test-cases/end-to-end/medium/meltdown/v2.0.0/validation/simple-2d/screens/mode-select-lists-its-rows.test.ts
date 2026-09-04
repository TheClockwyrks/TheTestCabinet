// screens/mode-select-lists-its-rows — every row of MODE_ITEMS is named on the mode
// screen.
//
// THE RULE. specs/screens.md's `modeselect` section: it "Draws the six rows of
// `MODE_ITEMS`: `CONTAINMENT`, `THE HUNDRED`, `DEEP POCKETS`, `BOTTLENECK`,
// `SUDDEN DEATH`, and `BACK`." specs/modes.md fixes what each mode changes; this
// item is only that a player can see every row is there — the five modes, and the
// `BACK` row that is the list's only way out on a touchscreen.
//
// THE COPY IS THE CASE'S. `MODE_ITEMS` lives in `constants.ts`, transcribed
// from specs/screens.md, so its exact strings are what the frame is read
// for. Matching is by substring and ignores case, because a row is commonly
// drawn with a marker or padding around it, and specs/overview.md fixes no
// typeface, no palette and no layout — so nothing here reads where a row was
// put or what colour it was drawn in.
//
// ONE FRAME, ON THE SCREEN ITSELF. The screen is posed with `setScreen`, which
// runs no entry effect (specs/instrumentation.md), so what is read is what the
// build draws for `modeselect` and not what some transition into it did. Where
// each row LEADS is decided by `screens.containment-opens-difficulty-select` and
// `screens.special-mode-starts-immediately`, and nothing is confirmed here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { MODE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  drawFrame,
  drewText,
  type Harness,
} from "../harness";
import { poseMenu } from "./menu";

/** The row the screen is posed on: the first, which is where a menu opens. */
const OPENING_ROW = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("names every row of the mode list on the mode screen", async () => {
  poseMenu(h, "modeselect", OPENING_ROW);
  const calls = await drawFrame(h);
  captureStill(h, "modes");

  assertEqual(
    h.snapshot().screen,
    "modeselect",
    "posing: the screen the list is read from (specs/screens.md)",
  );
  for (const item of MODE_ITEMS) {
    assertEqual(
      drewText(calls, item),
      true,
      `the ${JSON.stringify(item)} row of MODE_ITEMS drawn on the mode ` +
        `screen (specs/screens.md)`,
    );
  }
});
