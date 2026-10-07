// Wick — pointer/almanac-wheel-clamped: wheel travel past the end of the list
// stops at the last window.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/controls.md`, The pointer,
// rule 3, The wheel: the rows the travel gives are applied and "`almanacScroll`
// is held within `0` and `max(0, count − ALMANAC_ROWS)`, `count` being the
// number of entries the shown tab holds."
//
// WHERE THE FIGURE COMES FROM. `specs/ui.md`, "`almanac`", gives the `TOOLS`
// tab "the ten of `BASE_WEAPON_IDS`, then the six of `EVOLUTION_IDS`", sixteen
// entries, and `ALMANAC_ROWS` is `10`, so the bound is
// `max(0, 16 − 10)` = `6`. The check computes it from those two constants
// rather than naming `6`, so it states the rule and not one build's arithmetic.
//
// THE DRIVE. `setScreen("almanac")` — by setting `screen` with `menuIndex`,
// `almanacTab`, and `almanacScroll` all `0` and the run left as it stands
// (`specs/instrumentation.md`) — then one frame carrying `OVERSHOOT` (`40`)
// rows of downward travel, several times the whole list, so nothing but the
// bound can decide where the scroll lands.
//
// THE TOLERANCE. None: the bound is a whole row index.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ALMANAC_ROWS, ALMANAC_TOOL_IDS } from "../constants";
import {
  captureStill,
  createHarness,
  poseScreen,
  wheelBy,
  type Harness,
} from "../harness";

/** Rows of downward travel, several times the length of the whole list. */
const OVERSHOOT = 40;

/** `max(0, count − ALMANAC_ROWS)` for the TOOLS tab (specs/controls.md). */
const LAST_WINDOW = Math.max(0, ALMANAC_TOOL_IDS.length - ALMANAC_ROWS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds almanacScroll at the last window after travel past the end", async () => {
  h.reset();
  const opened = poseScreen(h, "almanac");
  assertEqual(opened.screen, "almanac", "the screen the wheel is turned on");
  assertEqual(opened.almanacTab, 0, "the tab the almanac opens on, TOOLS");
  assertEqual(opened.almanacScroll, 0, "the list's first visible row");

  const after = await wheelBy(h, OVERSHOOT);
  captureStill(h, "clamped");

  assertEqual(after.screen, "almanac", "the screen the wheel left");
  assertEqual(
    after.almanacScroll,
    LAST_WINDOW,
    "the list's first visible row at the end of the list (specs/controls.md, The wheel)",
  );
});
