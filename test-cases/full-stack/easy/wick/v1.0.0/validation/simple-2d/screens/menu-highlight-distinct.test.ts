// screens/menu-highlight-distinct — the highlighted menu item is drawn distinctly.
//
// WHAT THIS DECIDES. One thing: a player can see which item `confirm` would
// take. Moving `menuIndex` from the first title item to the second must change
// the picture where BOTH items are drawn: the one that lost the highlight and
// the one that took it.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md ("Presentation"): "On every menu the item at `menuIndex` is
//   drawn distinctly from the others, so a player always sees which item
//   `confirm` would accept."
//   specs/ui.md (`title`): the menu is `TITLE_ITEMS`, "stacked one above the
//   next", and "`menuIndex` is `0` on arriving".
//
// THE DRIVE. A reset to the title, whose first two items are read off the
// frame's own text to find where the build put them. The stage is split in two
// at the midpoint between those two anchors, which is layout-free: whatever the
// build's spacing, the first item lies above the line and the item the
// highlight moves onto below it. Two frames are drawn before the highlight
// moves and their difference is the DRIFT a build that animates its title
// carries; the highlight is then moved with the menu's own `down` key, which is
// `title-down-moves-highlight`'s point, and each half of the stage must differ
// from the frame before it by more than its own drift.
//
// WHAT IS NOT ASSERTED, AND WHY. Nothing about HOW the item is drawn
// distinctly. specs/ui.md "fixes no palette, no font, and no styling for any
// screen", and leaves each screen's layout to the build except where a table
// places one element relative to another, so a colour, a marker, a plate behind
// the text, a size, and a shift are all conformant and all move pixels.
//
// THE TOLERANCE. A pixel count against the drift measured on the same scene, so
// a build whose title is still passes on any visible highlight and a build that
// animates does not pass on the animation alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { STAGE_H, STAGE_W, TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  pixelsDiffering,
  present,
  tap,
  topAnchorOf,
  type Harness,
  type PixelRect,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("changes the pixels of both title items when the highlight moves", async () => {
  h.reset();
  const { calls } = await h.frameDraw();
  const view = h.viewport();
  const anchors = TITLE_ITEMS.map((item) =>
    present(topAnchorOf(calls, item), `where the frame drew ${item}`),
  );
  const split = Math.round(
    (anchors[0] + anchors[1]) / 2 / view.scale - view.offsetY / view.scale,
  );
  assertGreaterThan(
    split,
    0,
    "the line between the first two title items, in stage units",
  );

  const halves = (): [PixelRect, PixelRect] => [
    h.pixelRect(0, 0, STAGE_W, split),
    h.pixelRect(0, split, STAGE_W, STAGE_H - split),
  ];

  const first = halves();
  await h.frameDraw();
  const again = halves();
  const drift = [
    pixelsDiffering(first[0], again[0]),
    pixelsDiffering(first[1], again[1]),
  ];

  const moved = await tap(h, "ArrowDown");
  captureStill(h, "highlight");
  assertEqual(moved.menuIndex, 1, "the highlight moved onto the second item");
  const highlighted = halves();

  for (const half of [0, 1]) {
    assertGreaterThan(
      pixelsDiffering(again[half], highlighted[half]),
      drift[half],
      `pixels the moved highlight changed where ${TITLE_ITEMS[half]} is drawn, over that half's drift`,
    );
  }
});
