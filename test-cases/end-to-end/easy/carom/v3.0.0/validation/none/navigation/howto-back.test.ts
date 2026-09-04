// navigation/howto-back — Escape leaves the how-to screen for the title.
//
// specs/ui.md: on `howto`, `back` returns to the title, and a return to the title
// restores `menuIndex` from `titleIndex`. The snapshot reports both, so the
// selection the title comes back on is read straight off it.
//
// The how-to screen is POSED, with `openHowTo`: `reset` and one `setScreen`,
// which leaves `titleIndex` at the `0` a fresh title carries. So the `menuIndex`
// this point reads back is `0` — the figure the review item names — and it is
// that because nothing confirmed a title item on the way in. Walking the menu to
// `HOW TO PLAY` instead would have set `titleIndex` to `2` and made the same
// build read back `2`, which is the other reason the route is not the menu's:
// reaching the screen is this point's ground, and `title-howto` is where the
// route itself is graded.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openHowTo,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title, with the first item selected, on Escape", async () => {
  await openHowTo(h);
  assertEqual((await h.snapshot()).screen, "howto");

  await h.tap("Escape");
  await captureStill(h, "title");

  const title = await h.snapshot();
  assertEqual(title.screen, "title");
  assertEqual(title.menuIndex, title.titleIndex);
  assertEqual(title.menuIndex, 0);
});
