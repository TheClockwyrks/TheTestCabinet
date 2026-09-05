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
// cells one clear happens to empty; and a deal is posed by one operation, so no
// swap, no clear and no strain runs anywhere near the two frames being compared.
//
// HOW TWO FRAMES DECIDE IT. The round is begun, one frame is run so the build
// draws the deal it was handed, and the board's whole extent is read off the
// canvas. The game is then carried past the deal's own longest fall — the
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
import { FALL_SECONDS_PER_ROW } from "../constants";
import {
  captureReplay,
  createHarness,
  framesPast,
  patchDistance,
  startRound,
  type Harness,
  type Patch,
  type Viewport,
} from "../harness";

/**
 * Real milliseconds the produced art is given before the round begins.
 *
 * specs/assets.md has a build ship its gems as produced files, and a file is
 * decoded off the frame loop rather than inside it, so a board read before they
 * arrive could be drawn from placeholders in one frame and from sprites in the
 * next. This spends REAL time only: the simulation stands still through it.
 */
const ART_SETTLE_MS = 250;

let h: Harness;

/**
 * How far apart the sampled pixels of the board's extent stand, in device pixels.
 *
 * NOT a specification figure, and it exists for the process boundary rather than
 * for the measurement. The extent is 576 device pixels on a side at the stage
 * size, and naming every one of its pixels back to the page would be a third of a
 * million points crossing for one reading. `patchDistance` is a MEAN over the box,
 * so a grid taken evenly across it measures the same quantity as the whole box
 * does — and at four device pixels the grid is far finer than the `GEM_R` (`30`)
 * form of a single gem, which is what a fall moves.
 */
const BOARD_SAMPLE_STEP = 4;

/** The logical stage point a device pixel of the canvas stands at. */
function toLogical(
  view: Viewport,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: (x - view.offsetX) / view.scale,
    y: (y - view.offsetY) / view.scale,
  };
}

/**
 * The board's whole extent, sampled off the frame the canvas holds.
 *
 * `boardExtent()` is specs/board.md's own grid grown by `GEM_HIT_R` on each side,
 * so the box holds every cell of the field and the frame around it and nothing of
 * the readouts, which specs/ui.md keeps clear of that extent. It is shaped as a
 * {@link Patch} so `patchDistance` — the mean per-pixel distance every appearance
 * point in this suite reads — measures it, and the whole field is what a deal
 * moves.
 *
 * THE PIXELS ARE IN THE PAGE, so the grid is worked out here and carried across in
 * ONE crossing, every point named in the logical units {@link Harness.pixels}
 * takes. The two readings are sampled identically, so what `patchDistance`
 * compares is the same points of the same box on two frames.
 */
async function readBoard(): Promise<Patch> {
  const extent = boardExtent();
  const view = h.viewport();
  const origin = h.device(extent.x, extent.y);
  const across = Math.max(
    1,
    Math.ceil(Math.round(extent.w * view.scale) / BOARD_SAMPLE_STEP),
  );
  const down = Math.max(
    1,
    Math.ceil(Math.round(extent.h * view.scale) / BOARD_SAMPLE_STEP),
  );
  const points: { x: number; y: number }[] = [];
  for (let row = 0; row < down; row += 1) {
    for (let col = 0; col < across; col += 1) {
      points.push(
        toLogical(
          view,
          origin.x + col * BOARD_SAMPLE_STEP,
          origin.y + row * BOARD_SAMPLE_STEP,
        ),
      );
    }
  }
  const read = await h.pixels(points);
  const data = new Uint8ClampedArray(read.length * 4);
  read.forEach(([r, g, b, a], at) => {
    data[at * 4] = r;
    data[at * 4 + 1] = g;
    data[at * 4 + 2] = b;
    data[at * 4 + 3] = a;
  });
  return { half: extent.w / 2, width: across, height: down, data };
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the frame a board is dealt on apart from the same board once it has landed", async () => {
  await h.settle(ART_SETTLE_MS);

  const dealt = await captureReplay(h, "fall", async () => {
    // The round begins, and one frame draws the deal the build made.
    const round = await startRound(h);
    assertEqual(round.screen, "playing", "the screen a round begins on");
    await h.advance(1);
    const arriving = await readBoard();
    const board = await h.board();
    const opening = await h.snapshot();

    // The deal's own longest fall, read off the build rather than reckoned: R9
    // and the deal both leave each gem's `fell` to the build above a floor, so
    // the span to carry past is the one this deal reports.
    assertGreaterThan(
      opening.lastFall,
      0,
      "the rows the dealt board reports its longest fall as",
    );
    await h.advance(framesPast(opening.lastFall * FALL_SECONDS_PER_ROW));

    return {
      arriving,
      board,
      landed: await readBoard(),
      settledBoard: await h.board(),
    };
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
