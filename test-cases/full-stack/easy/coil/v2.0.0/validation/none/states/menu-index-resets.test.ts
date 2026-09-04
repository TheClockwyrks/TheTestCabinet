// states/menu-index-resets — arriving at a menu-bearing screen highlights its
// first item.
//
// specs/ui.md: "Arriving at any of these screens sets `menuIndex` to `0`." The
// screen left is the title with its highlight moved OFF the first item, because a
// build that simply never touches `menuIndex` would arrive on `0` from a screen
// that was already on `0` and pass without doing anything.
//
// The highlight is moved through the surface rather than by pressing `down`,
// because which item `down` lands on is `controls/menu-highlight-moves`; what is
// pressed here is the `confirm` that makes the crossing.

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

it("sets menuIndex to zero on arriving from a menu left off its first item", async () => {
  await openTitle(h);
  await h.debug.setMenuIndex(HOWTO_INDEX);
  const left = await h.snapshot();
  assertEqual(
    left.menuIndex,
    HOWTO_INDEX,
    "the highlighted item the title is left on",
  );

  await h.tap(KEY.confirm);
  await captureStill(h, "reset");

  const arrived = await h.snapshot();
  assertEqual(arrived.screen, "howto", "the screen arrived at");
  assertEqual(arrived.menuIndex, 0, "the highlighted item on arrival");
});
