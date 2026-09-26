// Floe — screens/title-highlight: the highlighted title item is drawn
// differently from the same item unhighlighted.
//
// `specs/ui.md` fixes it for every menu in the game, in one line under the
// screens table: "The highlighted item is drawn distinctly from the others." HOW
// it is made distinct is the build's — a colour, a weight, a size, a marker, a
// bar behind it — so what is read here is that the line was DRAWN DIFFERENTLY at
// all, in the one currency every one of those choices shows up in: the pixels the
// build painted on the item's own line of the screen. How far apart the two
// drawings are is appearance, which the reviewer judges.
//
// THE COMPARISON IS ONE ITEM AGAINST ITSELF. The two title entries are different
// words of different lengths, so "the highlighted one against the plain one"
// cannot be a pixel comparison between them; what it can be, and what it means,
// is the FIRST ITEM's line drawn with the highlight on it and the same line drawn
// without. Everything else on the line is identical between the two frames, so
// every pixel that differs is the highlight and nothing else, and a build that
// draws the highlighted entry exactly as it draws a plain one leaves every
// sampled pixel identical.
//
// THE LINE IS READ WHOLE, ACROSS THE STAGE. A build may mark its highlight beside
// the entry rather than on it — a caret, a bracket pair, a bar behind the row —
// and none of that lands inside the run of glyphs. So the band is the item's own
// line at full stage width, which catches a marker wherever on the line it was
// set, and it stops short of the second entry, whose highlight state differs
// between the two frames and would otherwise answer for the first.
//
// WHICH LINE THAT IS COMES FROM `menuItemRect`, NOT FROM THE DRAWN COPY. The
// item's line was once found by looking for a text run that CONTAINED the entry's
// word, and that reading is not sound: `specs/ui.md` fixes only the copy, so
// everything else a build puts on the title screen is its own, and a build that
// captions its title `ARCADE CROSSING` or leaves a `CROSSING TIME` readout on the
// HUD behind it has drawn `CROSS` somewhere the menu is not. The first such run
// won, the "menu step" became the distance from the HUD to the second entry, and
// the band ran off the top of the stage — clamped back onto it here, and refused
// outright by the engines that do not clamp, so the reading was of a strip of
// chrome rather than of the menu.
//
// `specs/instrumentation.md`'s `menuItemRect(index)` is the build's own answer to
// where an item is: "the region a pointer or a touch contact selects that item
// from", in logical units. `instrumentation/menu-item-rect` grades it on its own —
// every item of every menu has one, each of real extent, each inside the stage,
// and no two of one menu sharing a point — so this reading stands on something
// already checked, and the six pointer and touch points already stand there too.
// It also cannot send a band off the stage, because being inside the stage is
// part of what that point holds it to.
//
// THE BAND REACHES HALFWAY INTO THE GAP BELOW AND THE SAME DISTANCE ABOVE. A hit
// region need not be drawn to; a build may set its caret or its underline just
// outside one, so the region alone would be a stricter reading than "the item's
// own line". Half the gap to the next entry is as far as a band can go without
// reaching the entry itself, and `specs/ui.md` makes the title menu vertical and
// gives `CROSS` before `HOW TO PLAY`, so the gap is below the first entry and the
// two never meet.
//
// THE STRAIT BEHIND IS EMPTIED FIRST. `specs/ui.md` allows "a dim slice of the
// strait" behind the title, and a build is free to let it drift; the two frames
// are one tick apart, so a lane running behind the menu would put a difference on
// the line that the menu did not put there. Clearing the four rosters leaves a
// still backdrop, which is the isolation this reading needs: the only thing that
// changes between the two frames is which item is highlighted.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { STAGE_H, STAGE_W, TITLE_ITEMS } from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  menuRect,
  resetTo,
  type Harness,
  type MenuRect,
} from "../harness";

/** The entry the highlight is moved on and off: `CROSS`, `TITLE_ITEMS` index `0`. */
const LIT_ITEM = 0;

/** The entry the highlight is parked on for the second frame. */
const PLAIN_ITEM = 1;

/** The frame that draws the highlight moved off the first entry. */
const MOVE_FRAMES = 1;

/** How far a band reaches past its own region: half the gap to the next entry. */
function reachOf(lit: MenuRect, next: MenuRect): number {
  return Math.max(0, (next.y - (lit.y + lit.h)) / 2);
}

/** `value` held inside the stage's own rows, which is where a pixel exists. */
function onStage(value: number): number {
  return Math.min(Math.max(value, 0), STAGE_H - 1);
}

/** One horizontal band of the canvas, full stage width, as raw RGBA bytes. */
function band(h: Harness, top: number, bottom: number): Uint8ClampedArray {
  const from = h.device(0, top);
  const to = h.device(STAGE_W, bottom);
  const x = Math.max(0, Math.min(from.x, h.canvas.width - 1));
  const y = Math.max(0, Math.min(from.y, h.canvas.height - 1));
  const width = Math.max(1, Math.min(to.x - x, h.canvas.width - x));
  const height = Math.max(1, Math.min(to.y - y, h.canvas.height - y));
  return Uint8ClampedArray.from(h.ctx.getImageData(x, y, width, height).data);
}

/** The furthest apart any one pixel of the two bands is, in RGB distance. */
function furthestApart(
  lit: Uint8ClampedArray,
  plain: Uint8ClampedArray,
): number {
  let apart = 0;
  const span = Math.min(lit.length, plain.length);
  for (let i = 0; i + 3 < span; i += 4) {
    apart = Math.max(
      apart,
      colorDistance(
        { r: lit[i], g: lit[i + 1], b: lit[i + 2] },
        { r: plain[i], g: plain[i + 1], b: plain[i + 2] },
      ),
    );
  }
  return apart;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the highlighted title item apart from the same item unhighlighted", async () => {
  resetTo(h);
  // A still backdrop, so the only thing that moves between the two frames is the
  // highlight. Nothing the menu is drawn from is touched.
  h.debug.clearVehicles();
  h.debug.clearFloes();
  h.debug.clearBears();
  h.debug.clearFish();

  // The first entry highlighted.
  h.debug.setMenuIndex(LIT_ITEM);
  await h.advance(MOVE_FRAMES);
  captureStill(h, "title");

  // The line the first entry sits on, and the gap to the second, taken from the
  // build's own layout through `menuItemRect` (specs/instrumentation.md), so the
  // band is the row the build itself picks that entry from.
  const litRect = menuRect(h, LIT_ITEM);
  const nextRect = menuRect(h, PLAIN_ITEM);
  assertGreaterThan(
    nextRect.y,
    litRect.y,
    `${TITLE_ITEMS[PLAIN_ITEM]} below ${TITLE_ITEMS[LIT_ITEM]}, the two on ` +
      "lines of their own (specs/ui.md: a vertical menu of TITLE_ITEMS in that " +
      "order)",
  );

  const reach = reachOf(litRect, nextRect);
  const top = onStage(litRect.y - reach);
  const bottom = onStage(litRect.y + litRect.h + reach);
  const lit = band(h, top, bottom);

  // The same line with the highlight moved off it, and nothing else changed.
  h.debug.setMenuIndex(PLAIN_ITEM);
  await h.advance(MOVE_FRAMES);
  const plain = band(h, top, bottom);

  assertGreaterThan(
    furthestApart(lit, plain),
    0,
    `the highlighted ${TITLE_ITEMS[LIT_ITEM]} drawn distinctly from the plain ` +
      `one, ` +
      `as at least one pixel of its line drawn differently between the two ` +
      `(specs/ui.md)`,
  );
});
