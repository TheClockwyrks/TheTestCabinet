// navigation/howto-confirm — Enter leaves the how-to screen for the title.
//
// specs/ui.md: on `howto`, `confirm` returns to the title, and a return to the
// title restores `menuIndex` from `titleIndex`. The snapshot reports both, so the
// selection the title comes back on is read straight off it.
//
// The how-to screen is POSED, with `openHowTo`: `reset` and one `setScreen`,
// which leaves `titleIndex` at the `0` a fresh title carries, so the `menuIndex`
// read back is the `0` the review item names. Walking the menu to `HOW TO PLAY`
// would have confirmed a title item on the way in, set `titleIndex` to `2`, and
// made the same build read back `2`. The route in is this point's ground; the
// key out is its subject.

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

it("returns to the title, with the first item selected, on Enter", async () => {
  await openHowTo(h);
  assertEqual((await h.snapshot()).screen, "howto");

  await h.tap("Enter");
  await captureStill(h, "title");

  const title = await h.snapshot();
  assertEqual(title.screen, "title");
  assertEqual(title.menuIndex, title.titleIndex);
  assertEqual(title.menuIndex, 0);
});
