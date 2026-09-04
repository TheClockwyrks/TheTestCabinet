// Wireworm — screens/title-highlight: the highlighted title item is drawn
// distinctly from the item that is not.
//
// "The highlighted item is drawn distinctly from the others, so a player always
// sees which item `confirm` would take" (`specs/ui.md`). What a script can
// decide about that is whether the screen's menu DEPENDS on which item is
// highlighted, so the highlight is moved with the surface's own `setMenuIndex`
// and the band the menu occupies is read before and after.
//
// The band is the full stage width across the rows the item baselines span,
// padded above and below, taken off the text the frame itself drew rather than
// from any layout of ours: how a build lays its menu out is the build's. Full
// width because a build may mark its highlight anywhere on the row — a caret to
// the left, a rule to the right, a bar behind the whole line — and a narrower
// window would fail a screen that is perfectly clear to a player.
//
// Locating the band needs the items to have been drawn, which is
// `screens/title-screen`'s requirement rather than this one's. That coupling is
// unavoidable — a band cannot be found without the rows being on the canvas —
// and it runs one way only: a build that omits its tagline still fails the copy
// item alone.
//
// A CONTROL, so an animated title is not read as a highlight. Two frames are
// drawn at the SAME highlight first, and what changes between them is whatever
// the screen animates on its own. The move then has to change the band by more
// than that, by a further HIGHLIGHT_PIXELS — so a build that draws every item
// identically fails whether its background moves or not.

import { afterEach, beforeEach, it } from "vitest";
import { STAGE_H, STAGE_W, TITLE_ITEMS } from "../constants";
import { assertEqual, assertGreaterThan, fail } from "../assert";
import {
  captureStill,
  createHarness,
  drawnTextSpans,
  type Harness,
  resetTo,
} from "../harness";

/**
 * How far above and below the item baselines the read band reaches, in logical
 * units.
 *
 * A baseline is the anchor a run of text is drawn about, so a band that stopped
 * at the baselines would hold no glyph at all. This case fixes no type size, so
 * the figure is taken from the stage: 32 units is one board tile
 * (specs/board.md, TILE), which is comfortably taller than the type a menu
 * item is set in on a 720-unit stage and short of any second row of copy.
 */
const BAND_PAD = 32;

/**
 * How many pixels of the band the move has to change, over and above whatever
 * the screen changes on its own.
 *
 * A band across the whole 1280-unit stage holds tens of thousands of pixels, and
 * the least a "drawn distinctly" highlight can amount to is the glyphs of one
 * short word set in a different colour: seven characters of body type is already
 * well over a thousand pixels, and the item losing the highlight changes as many
 * again. 400 is under half of one such word, so it cannot be met by a stray
 * anti-aliased edge and cannot fail a highlight a player can see.
 */
const HIGHLIGHT_PIXELS = 400;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Draw one whole frame from a clean call log. */
async function drawFrame(): Promise<void> {
  h.calls.length = 0;
  await h.advance(1);
}

/** The baseline of the run of text carrying `item`, in logical units. */
function baselineOf(item: string): number {
  const wanted = item.trim().toLowerCase();
  const span = drawnTextSpans(h).find((run) =>
    run.text.toLowerCase().includes(wanted),
  );
  if (span === undefined) {
    fail(
      `the title frame to draw the ${item} item (specs/ui.md)`,
      "no such run",
    );
  }
  return span.y;
}

/** The device pixels of a band spanning the stage between two logical rows. */
function bandPixels(top: number, bottom: number): Uint8ClampedArray {
  const a = h.device(0, Math.max(0, top));
  const b = h.device(STAGE_W, Math.min(STAGE_H, bottom));
  const width = Math.max(1, b.x - a.x);
  const height = Math.max(1, b.y - a.y);
  return Uint8ClampedArray.from(
    h.ctx.getImageData(a.x, a.y, width, height).data,
  );
}

/** How many pixels of two readings of the same band differ in any channel. */
function differingPixels(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
): number {
  let differing = 0;
  for (let i = 0; i + 3 < before.length; i += 4) {
    if (
      before[i] !== after[i] ||
      before[i + 1] !== after[i + 1] ||
      before[i + 2] !== after[i + 2] ||
      before[i + 3] !== after[i + 3]
    ) {
      differing += 1;
    }
  }
  return differing;
}

it("draws the menu band differently with the highlight moved", async () => {
  resetTo(h);
  assertEqual(
    h.snapshot().menuIndex,
    0,
    "the title is posed with its first item highlighted",
  );

  await drawFrame();

  // The band the menu occupies, off the runs this frame drew.
  const baselines = TITLE_ITEMS.map((item) => baselineOf(item));
  const top = Math.min(...baselines) - BAND_PAD;
  const bottom = Math.max(...baselines) + BAND_PAD;
  const first = bandPixels(top, bottom);

  // The control: a second frame at the same highlight.
  await drawFrame();
  const second = bandPixels(top, bottom);
  const restless = differingPixels(first, second);

  // The move: the last item highlighted instead of the first.
  const last = TITLE_ITEMS.length - 1;
  h.debug.setMenuIndex(last);
  await drawFrame();
  assertEqual(
    h.snapshot().menuIndex,
    last,
    "setMenuIndex moves the title's highlight (specs/instrumentation.md)",
  );
  const moved = bandPixels(top, bottom);
  captureStill(h, "title");

  assertGreaterThan(
    differingPixels(second, moved),
    restless + HIGHLIGHT_PIXELS,
    "moving the highlight changes the menu band by more than the screen " +
      "changes on its own, so the highlighted item is drawn distinctly " +
      "from the other (specs/ui.md)",
  );
});
