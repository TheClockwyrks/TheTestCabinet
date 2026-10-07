// handling/touch-drag-does-not-scroll — dragging a card with a finger leaves the
// page where it was.
//
// THE RULE. `specs/controls.md`, How input reaches the game, of the mouse and the
// touchscreen standing on the same footing: "so the game is complete on a touch
// device with no mouse attached, and dragging a card neither scrolls nor zooms
// the page."
//
// SCOPED TO THIS ENGINE, because under the other two the engine owns the page and
// the touch-action it sets on the canvas. Here the build wrote the whole runtime
// layer, `index.html` included is the case's, and what the page does under a
// finger is the build's own work.
//
// WHAT IS READ, AND WHY IT IS THE PAGE RATHER THAN THE BOARD. A build that
// answers the contact perfectly and lets the browser pan underneath makes the
// table walk out from under the player's finger, which is a fault about the
// DOCUMENT rather than about the game — so the reading is the page's own scroll
// offsets and its visual viewport's scale and offsets, taken before the gesture
// and again after it. `handling/touch-lifts-a-run` and
// `handling/touch-completes-a-drop` are the points that decide what the gesture
// does to the board.
//
// THE PAGE IS GIVEN SOMETHING TO SCROLL. A document that cannot scroll cannot
// fail this reading, and a build is free to lay its canvas out so that nothing
// overflows — so the drag is driven inside a viewport SHORTER than the stage,
// which is a window a player really might have. The harness fits the stage into
// whatever window it is given (`specs/overview.md`), so the game is fully playable
// at this shape; what changes is that the document now has room to move.
//
// THE GESTURE IS A REAL DRAG, from a card to a neighbouring column, so a build
// that suppresses the browser's default only on a tap is caught.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import {
  captureStill,
  card,
  cardCenter,
  createHarness,
  dropRect,
  openTable,
  pileTopLeft,
  poseColumn,
  rectCenter,
  touchGlide,
  touchPress,
  touchRelease,
  type Harness,
} from "../harness";

/**
 * The window the gesture is driven in: the stage's width, and half its height.
 *
 * A shape a player really might have, and one the build has to letterbox into —
 * so the document has room to scroll under a finger that the stage's own shape
 * would not give it.
 */
const CSS_WIDTH = STAGE_W;
const CSS_HEIGHT = Math.round(STAGE_H / 2);

/** The column the run is lifted from, and the column it is carried toward. */
const SOURCE = 2;
const TARGET = 4;
const HELD = "5S";
const TARGET_CARD = "6H";

/** How the page is standing, as one comparable reading. */
interface PageView {
  scrollX: number;
  scrollY: number;
  scale: number;
  offsetLeft: number;
  offsetTop: number;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ cssWidth: CSS_WIDTH, cssHeight: CSS_HEIGHT });
});

afterEach(async () => {
  await h.dispose();
});

/** Where the page is scrolled to, and how its visual viewport is standing. */
function readPage(): Promise<PageView> {
  return h.page.evaluate(() => {
    const visual = window.visualViewport;
    return {
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      scale: visual === null ? 1 : visual.scale,
      offsetLeft: visual === null ? 0 : visual.offsetLeft,
      offsetTop: visual === null ? 0 : visual.offsetTop,
    };
  });
}

it("leaves the page's scroll and scale where the drag found them", async () => {
  await openTable(h);
  await poseColumn(h, SOURCE, [card(HELD)]);
  await poseColumn(h, TARGET, [card(TARGET_CARD)]);

  const before = await readPage();

  const from = pileTopLeft("tableau", SOURCE);
  const press = cardCenter(from.x, from.y);
  const landing = rectCenter(dropRect("tableau", TARGET, [true]));

  await touchPress(h, press.x, press.y);
  await touchGlide(h, landing.x, landing.y);
  await touchRelease(h);

  const after = await readPage();

  await h.advance(1);
  // Before the assertion, so a page that walked still leaves the picture of
  // where it ended up.
  await captureStill(h, "still");

  assertEqual(
    JSON.stringify(after),
    JSON.stringify(before),
    `the page's scroll position and visual viewport after a finger dragged a ` +
      `card across the table, against where they stood before it — dragging a ` +
      `card neither scrolls nor zooms the page (specs/controls.md)`,
  );
});
