// screens/howto-reachable — confirm on HOW TO PLAY opens the how-to screen.
//
// specs/screens.md, on `title`: "`confirm` on `HOW TO PLAY` sets `screen` to
// `howto`." HOW TO PLAY is entry `1` of the title menu.
//
// THE HIGHLIGHT IS POSED ONTO THE ENTRY rather than walked there with the `down`
// key: how the highlight moves is `controls/arrow-down-moves-highlight`'s own
// point, and a build whose only fault is its `down` key must fail there rather
// than here. What is pressed is `confirm`, which is the action this point is
// about.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { KEYS, TITLE_ITEMS } from "../constants";
import {
  captureStill,
  openHarness,
  poseMenu,
  tap,
  type Harness,
} from "../harness";

/** The key that carries `confirm` alone — `Space` also carries `launch`. */
const CONFIRM = KEYS.confirm[1];
/** Entry 1 of the title menu: HOW TO PLAY. */
const HOWTO_ENTRY = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("confirm on HOW TO PLAY sets screen to howto", async () => {
  h.reset();
  const posed = poseMenu(h, "title", HOWTO_ENTRY);
  assertEqual(posed.screen, "title", "the screen the menu is worked on");
  assertEqual(
    posed.menu.index,
    HOWTO_ENTRY,
    "the highlighted entry, HOW TO PLAY",
  );

  await tap(h, CONFIRM);
  captureStill(h, "howto-screen");

  assertEqual(
    h.snapshot().screen,
    "howto",
    "the screen confirm on HOW TO PLAY set",
  );
});
