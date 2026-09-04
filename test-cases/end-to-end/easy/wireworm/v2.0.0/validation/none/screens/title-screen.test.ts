// Wireworm — screens/title-screen: the title screen carries its title, its
// tagline and both menu items, and it marks which of them is highlighted.
//
// specs/ui.md's `title` table fixes three pieces of copy — `TITLE_TEXT`
// (WIREWORM), `TAGLINE_TEXT` (CUT THE CURRENT) and both entries of
// `TITLE_ITEMS` — and then one rule about how they are arranged: "The
// highlighted item is drawn distinctly from the others, so a player always sees
// which item `confirm` would take."
//
// The copy is matched by SUBSTRING, because the words are the case's and the
// presentation is the build's: a menu entry is commonly drawn with a selection
// marker or padding around it, and requiring the exact run would fail a screen
// showing precisely the right words.
//
// The highlight is read as a DIFFERENCE rather than as a treatment, because the
// specification fixes no treatment: a colour, a weight, a marker beside the row
// and a plate behind it are all conformant. So the frame is drawn once with the
// highlight on the first item and once with it on the second, and the two must
// not come out identical — which every one of those treatments satisfies, and a
// screen that marks nothing does not. It is a comparison between two frames of
// the same build, so it fixes no threshold; whether the distinction READS at a
// glance is the reviewer's, from the captured still. A build whose title screen
// animates would satisfy it incidentally, which is the price of not fixing a
// treatment the case deliberately left open.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual } from "../assert";
import { TAGLINE_TEXT, TITLE_ITEMS, TITLE_TEXT } from "../constants";
import {
  captureStill,
  createHarness,
  drewText,
  type Harness,
} from "../harness";
import { renderDigest } from "./screens";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the title, the tagline and both menu items, marking the highlight", async () => {
  const calls = await h.frameCalls();
  await captureStill(h, "title");

  const opened = await h.snapshot();
  assertEqual(opened.screen, "title", "the game opens on the title");
  assertEqual(opened.menuIndex, 0, "the highlight on arriving at the title");

  assertEqual(drewText(calls, TITLE_TEXT), true, `draws "${TITLE_TEXT}"`);
  assertEqual(drewText(calls, TAGLINE_TEXT), true, `draws "${TAGLINE_TEXT}"`);
  for (const item of TITLE_ITEMS) {
    assertEqual(drewText(calls, item), true, `draws the menu item "${item}"`);
  }

  // The same screen, the highlight one item on: the frame must not be the same
  // picture, or nothing on it says which item `confirm` would take.
  const onFirst = renderDigest(calls);
  await h.debug.setMenuIndex(1);
  const onSecond = renderDigest(await h.frameCalls());
  assertNotEqual(
    onSecond,
    onFirst,
    `the frame with "${TITLE_ITEMS[1]}" highlighted differs from the one with "${TITLE_ITEMS[0]}" highlighted`,
  );
});
