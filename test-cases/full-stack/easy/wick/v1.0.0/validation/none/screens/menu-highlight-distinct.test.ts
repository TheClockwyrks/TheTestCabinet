// screens/menu-highlight-distinct — the highlighted menu item is drawn
// distinctly, and the highlight moves with `menuIndex`.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("Presentation"): "On every menu
// the item at `menuIndex` is drawn distinctly from the others, so a player
// always sees which item `confirm` would accept." specs/ui.md ("`title`") is
// where the menu read here comes from: `TITLE_ITEMS`, "stacked one above the
// next", with "`menuIndex` is `0` on arriving" and "`up` and `down` move the
// highlight by one item". So the frame with the first item highlighted and the
// frame with the second differ on BOTH rows: the first loses the highlight and
// the second gains it. A build that draws every item alike differs on neither.
//
// WHY THE WORLD IS POSED AS IT IS. Nothing is posed: the title is where the
// harness's opening reset leaves the game, and one REAL `ArrowDown` moves the
// highlight. Neither frame ticks anything, so the only thing that can differ
// between them is what the build draws for the highlight. Each item's row is
// found from the text the frame drew rather than from a layout the
// specification does not fix.
//
// THE TOLERANCE. The band read around each row is the shorter of `48` units and
// the gap to its neighbour, so a band never reaches the row below, and any
// difference at all inside it counts: the specification asks for a distinct
// drawing and fixes no palette, no font and no styling, so a build that changes
// a colour, a weight, or a marker passes and one that changes nothing fails.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  pixelsDiffering,
  pressDown,
  type Harness,
} from "../harness";
import { bandPixels, mustRowY, shown } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws both title items differently when the highlight moves from one to the other", async () => {
  const title = await h.snapshot();
  assertEqual(title.screen, "title", "the screen the frames are read on");
  assertEqual(title.menuIndex, 0, "the highlighted item on the first frame");

  const page = await shown(h);
  const rows = TITLE_ITEMS.map((item) =>
    mustRowY(page, item, `the menu item ${item}`),
  );
  const gap = rows[1]! - rows[0]!;
  assertGreaterThan(
    gap,
    0,
    "the gap between the first item's row and the second's",
  );
  const firstBefore = await bandPixels(h, rows[0]!, gap);
  const secondBefore = await bandPixels(h, rows[1]!, gap);

  const moved = await pressDown(h);
  await captureStill(h, "highlight");
  assertEqual(moved.menuIndex, 1, "the highlighted item on the second frame");
  const firstAfter = await bandPixels(h, rows[0]!, gap);
  const secondAfter = await bandPixels(h, rows[1]!, gap);

  assertGreaterThan(
    pixelsDiffering(firstBefore, firstAfter),
    0,
    `pixels changed on the row of ${TITLE_ITEMS[0]} when the highlight left it`,
  );
  assertGreaterThan(
    pixelsDiffering(secondBefore, secondAfter),
    0,
    `pixels changed on the row of ${TITLE_ITEMS[1]} when the highlight arrived`,
  );
});
