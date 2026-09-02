// Wick — screens/menu-highlight-distinct: the highlighted item is drawn
// differently from the others, and the difference follows `menuIndex`.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, Presentation: "On
// every menu the item at `menuIndex` is drawn distinctly from the others, so a
// player always sees which item `confirm` would accept." `specs/ui.md`,
// "`title`", gives that menu two items, `TITLE_ITEMS`, arriving on index `0`.
//
// WHAT IS READ, AND WHY. The pixels of each item's own rows, on the frame with
// the first item highlighted and on the frame with the second highlighted. A
// highlight that follows `menuIndex` changes BOTH bands: the one it left and
// the one it reached. A build whose menu draws both items the same way changes
// neither, and one that draws a fixed marker changes neither. How the
// highlight looks is entirely the build's (`specs/ui.md` fixes "no palette, no
// font, no layout, and no styling"), so nothing but "these rows are not the
// same picture" is read of it.
//
// WHERE THE BANDS COME FROM. The anchors the frame drew each item's text at,
// taken off the first frame and used unchanged on the second, so the two
// readings cover the same rectangle of canvas. Each band spans the full stage
// width, so a marker drawn beside the words counts as much as the words.
//
// THE DRIVE. `reset` to the title screen, one frame, one real `ArrowDown`,
// one frame.
//
// THE TOLERANCE. A band counts as redrawn at more than `MOVED_PIXELS` (`32`)
// pixels differing by more than `PIXEL_CHANNEL_EPS` (`8`) in a channel, so
// neither anti-aliasing nor a stray pixel reads as a highlight.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNotNull } from "../assert";
import { PIXEL_CHANNEL_EPS, TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  pixelsDiffering,
  tap,
  textDraws,
  type Harness,
} from "../harness";
import { anchorY, bandAt } from "./stage";

/** How many pixels of an item's rows must change for the highlight to have moved. */
const MOVED_PIXELS = 32;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("redraws both title items when the highlight moves between them", async () => {
  h.reset();
  const first = await h.frameDraw();
  const draws = textDraws(first.calls);
  const anchors = TITLE_ITEMS.map((item) => anchorY(draws, item));
  for (const [index, at] of anchors.entries()) {
    assertNotNull(at, `where ${TITLE_ITEMS[index]} was drawn`);
  }
  const before = anchors.map((at) => bandAt(h, at as number));

  const moved = await tap(h, "ArrowDown");
  await h.frameDraw();
  captureStill(h, "highlight");
  assertEqual(moved.menuIndex, 1, "menuIndex on the second frame");

  for (const [index, item] of TITLE_ITEMS.entries()) {
    assertGreaterThan(
      pixelsDiffering(
        before[index],
        bandAt(h, anchors[index] as number),
        PIXEL_CHANNEL_EPS,
      ),
      MOVED_PIXELS,
      `pixels of ${item}'s own rows that changed when the highlight moved`,
    );
  }
});
