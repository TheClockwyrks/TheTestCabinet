// states/howto-reachable — confirming HOW TO PLAY opens the how-to screen.
//
// specs/ui.md: the title menu's second item is `HOW TO PLAY`, and "`confirm` on
// `HOW TO PLAY` sets `screen` to `howto`."
//
// The highlight is put on the second item through the surface rather than by
// pressing `down`, because which item `down` lands on is
// `controls/menu-highlight-moves`, and a build whose highlight will not move must
// fail that point alone rather than this one as well. What is pressed here is
// `confirm`, which is the whole of what this decides.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { KEY } from "../constants";
import {
  captureStill,
  createHarness,
  openTitle,
  type Harness,
} from "../harness";

/** `HOW TO PLAY` is the second item of `TITLE_ITEMS` (specs/ui.md). */
const HOWTO_INDEX = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sets the screen to howto on confirm at HOW TO PLAY", async () => {
  await openTitle(h);
  await h.debug.setMenuIndex(HOWTO_INDEX);

  await h.tap(KEY.confirm);
  await captureStill(h, "howto");

  assertEqual(
    (await h.snapshot()).screen,
    "howto",
    "the screen confirm on HOW TO PLAY opened",
  );
});
