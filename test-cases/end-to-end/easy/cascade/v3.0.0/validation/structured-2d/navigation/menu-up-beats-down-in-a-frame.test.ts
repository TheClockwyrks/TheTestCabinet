// navigation/menu-up-beats-down-in-a-frame — a frame carrying both an up edge and
// a down edge moves the selection up one and no further.
//
// THE RULE. `specs/controls.md`, at the end of the keyboard section: "When
// several edges arrive on one frame, `menu-up` is applied before `menu-down`, and
// movement before `menu-confirm`: a frame carrying both an up edge and a down
// edge moves up only."
//
// WHY IT IS `passable`. It is an edge case of the general rule rather than a rule
// of its own: a player who presses one key at a time never meets it, and a build
// that reads the two the other way round still answers every single edge
// correctly — `navigation/hud-menu-up` and `navigation/hud-menu-down` are the
// points that decide those.
//
// AND WHY THE ANSWER IS `1` RATHER THAN `2`. The three wrong models read as three
// different numbers on the HUD's three-item menu, which is why the selection
// starts in the middle: applied up-then-down the selection comes back to where it
// started (`1`); applied down-then-up it does the same; applied up alone, as the
// rule requires, it reads `0`. So a build that applies both edges reads `1` and a
// build that applies the down edge alone reads `2`.
//
// BOTH EDGES ARRIVE ON ONE FRAME, which is what the rule is about: every key goes
// down before the frame runs and comes up after it
// ({@link pressKeysInOneFrame}), so a build reading press edges once a frame sees
// both on that frame.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { MENU_DOWN_KEYS, MENU_UP_KEYS } from "../constants";
import {
  captureStill,
  createHarness,
  openTable,
  pressKeysInOneFrame,
  type Harness,
} from "../harness";

/** Where the selection starts: the middle of the HUD's three items. */
const FROM = 1;

/** Where `menu-up` alone leaves it. */
const TO = 0;

/** One key of each pair, delivered together on one frame. */
const CODES = [MENU_UP_KEYS[0], MENU_DOWN_KEYS[0]] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves up one when both edges arrive on the same frame", async () => {
  openTable(h);
  h.debug.setMenuIndex(FROM);
  assertEqual(
    h.snapshot().menuIndex,
    FROM,
    "posing: menuIndex before the frame — the middle of the HUD's three " +
      "items, so each wrong reading of the rule lands on a different number",
  );

  await pressKeysInOneFrame(h, CODES);
  const after = h.snapshot();

  await h.advance(1);
  // Before the assertions, so a frame read the wrong way still leaves the
  // picture of the menu it left.
  captureStill(h, "menu");

  assertEqual(
    after.menuIndex,
    TO,
    `menuIndex after one frame carrying both ${CODES[0]} and ${CODES[1]} from ` +
      `menuIndex ${FROM} — menu-up is applied before menu-down, and a frame ` +
      `carrying both moves up only (specs/controls.md), so ${FROM} means both ` +
      `edges were applied and 2 means the down edge was applied alone`,
  );
  assertEqual(
    after.screen,
    "playing",
    "the screen that frame left, which a movement action does not change " +
      "(specs/controls.md)",
  );
});
