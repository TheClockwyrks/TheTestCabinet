// Facet — appearance/fall-animates: the frame a fresh board is dealt on is drawn
// differently from the same board once its fall has run, so the gems travel down
// into their cells.
//
// WHAT IS BEING DECIDED. specs/ui.md lists falling gems among the three things in
// motion on the `playing` screen — "Falling gems — Every gem a chain step moved,
// and every gem a fresh board is dealt with, travels from where it came from down
// into its cell, a gem drawn from above the board entering from above the board's
// top row" — and specs/overview.md holds the same line. specs/rules.md gives the
// travel its span and says where a dealt gem comes from: "The whole board is
// dealt in from above, so a gem dealt into row `r` carries a `fell` of at least
// `r + 1`", each row of fall taking `FALL_SECONDS_PER_ROW` (`0.05`).
// specs/assets.md names the failure this rules out outright — a build that
// "teleports a falling gem into its cell rather than dropping it".
//
// WHY THE DEAL RATHER THAN A CHAIN'S REFILL. A deal moves EVERY gem on the board,
// so the reading has the whole field to work with rather than the three or four
// cells one clear happens to empty; and a deal is the whole of what opening a
// round does to the field, so no swap, no clear and no strain runs anywhere near
// the two frames being compared.
//
// THE ROUND IS PLAYED INTO, NOT POSED. specs/ui.md's `PLAY` "Starts a fresh
// round, as specs/rules.md describes", and the deal that round opens with is the
// deal specs/ui.md has traveling into its cells. The deal a check could pose
// instead — specs/instrumentation.md's `dealBoard` — is fixed there as a write of
// the BOARD and of nothing else: "The board is the whole of what it writes: the
// screen, `menuIndex`, the phase, the selection and every figure of the round
// stand where they were." Unlike `setScreen`, it carries no clause putting the
// game where a player's own route would put it, so a build that pours a fresh
// board into place off a clock its round-opening starts is not answering this
// question wrongly when a posed board sits still — it is being asked a question
// the specification never put. The round is therefore opened the way
// `screens/start-round-from-title` opens one: the highlight is posed onto `PLAY`
// — `setMenuIndex` takes no item — and `confirm` is what takes it, through the
// key specs/controls.md binds and the build's own input path. THAT the item opens
// a fresh round is that point's business; this one only reads the frames the deal
// it opened is drawn on.
//
// HOW TWO FRAMES DECIDE IT. `PLAY` is taken, which delivers `confirm` inside a
// frame's own update, so the frame that deals the board is the frame that draws
// it; the board's whole extent is read off the canvas. The game is then carried
// past the deal's own longest fall — the
// `lastFall` the snapshot reports, times `FALL_SECONDS_PER_ROW`, with the margin
// `framesPast` adds so a build comparing `>=` and one comparing `>` both read
// alike — and the same extent is read again. A board whose gems traveled reads
// apart across those two frames; a board whose gems appeared in their cells reads
// the same.
//
// WHAT MAKES THE DIFFERENCE THE DRAWING AND NOTHING ELSE. The two renders are
// held to the same board first: every cell of specs/board.md's notation is
// compared between them, so the kind, the cut and the strain of all sixty-four
// gems agree. Nothing about the game's own state changed between the two frames,
// and the only thing left for them to differ by is where the gems were drawn.
//
// WHAT IS NOT READ. How a gem travels, from how far above the board it starts,
// which gem lands first, or how the fall is eased. specs/rules.md hands each
// dealt gem's own `fell` to the build above a floor, and the reading is of the
// extent as a whole rather than of any one cell.

import { afterEach, beforeEach, it } from "vitest";
import { assertBoardEquals, boardExtent } from "../board";
import { assertEqual, assertGreaterThan } from "../assert";
import { FALL_SECONDS_PER_ROW, TITLE_ITEMS } from "../constants";
import {
  captureReplay,
  createHarness,
  framesPast,
  patchDistance,
  takeMenuItem,
  type Harness,
  type Patch,
} from "../harness";

/** Where `PLAY` sits on the title menu, from specs/ui.md's `TITLE_ITEMS`. */
const PLAY_INDEX = TITLE_ITEMS.indexOf("PLAY");

let h: Harness;

/**
 * The board's whole extent, in device pixels, off the frame the canvas holds.
 *
 * `boardExtent()` is specs/board.md's own grid grown by `GEM_HIT_R` on each side,
 * so the box holds every cell of the field and the frame around it and nothing of
 * the readouts, which specs/ui.md keeps clear of that extent. It is shaped as a
 * {@link Patch} so `patchDistance` — the mean per-pixel distance every appearance
 * point in this suite reads — measures it, and the whole field is what a deal
 * moves.
 */
function readBoard(): Patch {
  const extent = boardExtent();
  const view = h.viewport();
  const origin = h.device(extent.x, extent.y);
  const width = Math.max(1, Math.round(extent.w * view.scale));
  const height = Math.max(1, Math.round(extent.h * view.scale));
  const image = h.ctx.getImageData(origin.x, origin.y, width, height);
  return {
    half: extent.w / 2,
    width: image.width,
    height: image.height,
    data: image.data as unknown as Uint8ClampedArray,
  };
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the frame a board is dealt on apart from the same board once it has landed", async () => {
  const dealt = await captureReplay(h, "fall", async () => {
    // The round is opened from the title the way a player opens one, and the
    // frame that delivers `confirm` is the frame the deal is drawn on.
    h.debug.reset();
    assertEqual(h.snapshot().screen, "title", "the screen PLAY is taken from");
    const round = await takeMenuItem(h, PLAY_INDEX);
    assertEqual(round.screen, "playing", "the screen a round begins on");
    const arriving = readBoard();
    const board = h.board();
    const opening = h.snapshot();

    // The deal's own longest fall, read off the build rather than reckoned: R9
    // and the deal both leave each gem's `fell` to the build above a floor, so
    // the span to carry past is the one this deal reports.
    assertGreaterThan(
      opening.lastFall,
      0,
      "the rows the dealt board reports its longest fall as",
    );
    await h.advance(framesPast(opening.lastFall * FALL_SECONDS_PER_ROW));

    return { arriving, board, landed: readBoard(), settledBoard: h.board() };
  });

  // The same sixty-four gems in the same sixty-four cells across both frames, so
  // what separates the two renders is where those gems were drawn.
  assertBoardEquals(
    dealt.settledBoard,
    dealt.board,
    "the board once the deal had landed, against the board it was dealt as",
  );

  assertGreaterThan(
    patchDistance(dealt.arriving, dealt.landed),
    0,
    "how far the board's extent reads on the frame it was dealt on from the " +
      "same extent once its fall had run",
  );
});
