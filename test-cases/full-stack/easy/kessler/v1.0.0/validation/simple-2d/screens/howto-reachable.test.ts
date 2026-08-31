// screens/howto-reachable — confirm on HOW TO PLAY opens the how-to screen.
//
// specs/screens.md, on `title`: "`confirm` on `HOW TO PLAY` sets `screen` to
// `howto`." HOW TO PLAY is entry `1` of the title menu, and the menu is the
// only route onto it — the surface poses no highlight — so the highlight is
// moved there with one real `down` press first, checked as a precondition:
// a build whose menu cannot reach the entry cannot pose this scenario and
// fails the point, while the menu's own moves and wraps stay their own points.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { KEYS } from "../constants";
import { captureStill, openHarness, tap, type Harness } from "../harness";

/** The key that carries `confirm` alone — `Space` also carries `launch`. */
const CONFIRM = KEYS.confirm[1];
/** The key specs/controls.md binds to `down`. */
const DOWN = KEYS.down[0];

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("confirm on HOW TO PLAY sets screen to howto", async () => {
  h.reset();
  const posed = h.snapshot();
  assertEqual(posed.screen, "title", "the screen the menu is worked on");

  await tap(h, DOWN);
  assertEqual(h.snapshot().menu.index, 1, "the highlighted entry, HOW TO PLAY");

  await tap(h, CONFIRM);
  captureStill(h, "howto-screen");

  assertEqual(
    h.snapshot().screen,
    "howto",
    "the screen confirm on HOW TO PLAY set",
  );
});
