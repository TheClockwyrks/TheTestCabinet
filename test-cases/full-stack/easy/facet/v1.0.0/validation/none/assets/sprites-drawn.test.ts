// assets/sprites-drawn — the gems standing on the board are drawn from produced
// images: a frame of the playing screen issues at least one image draw for every
// gem the settled board holds, so the stones are blitted sprites rather than
// shapes the render draws in code.
//
// WHAT THE SPECIFICATION SAYS, AND WHERE THE FIGURE COMES FROM. specs/assets.md
// opens its sprite section with "Every gem on the board is a produced sprite",
// produced one PNG at a time with `draw` on a "64 x 64" canvas and landed under
// `public/assets/gems/`, and it closes by naming the failure outright: a build
// that "draws its gems as code-drawn rounded rectangles ... has not met this
// contract, however exactly the rules are implemented". specs/board.md fixes how
// many gems that is — the grid is `GRID_COLS` (`8`) by `GRID_ROWS` (`8`), and
// "Every cell holds exactly one gem while the board is settled" — so a settled
// board carries sixty-four gems and each one of them is a produced sprite. A
// frame that paints that board therefore blits sixty-four images at the least,
// and the bar here is the board's own occupancy rather than a figure of this
// check's choosing.
//
// WHY A COUNT AND NOT A PRESENCE. specs/assets.md also has the build produce
// "The board frame, one sprite", so a build that drew every one of its gems in
// code and blitted nothing but that frame would still put an image on the
// screen. Reading presence alone would pass exactly the build the specification
// spends its closing section refusing. The count is what separates them: sixty-
// four gems drawn from images clear it, one frame sprite over sixty-four
// code-drawn stones does not.
//
// WHAT THE BAR DELIBERATELY LEAVES OPEN. It counts image draws and nothing else.
//
//   - WHICH image, and what is in it. specs/assets.md fixes that the sprites
//     exist and what they must read as; `assets/gem-sprites-produced` decides
//     that the produced files are there, and the appearance items decide that
//     the drawn stones are told apart. Nothing here reads a source, a size, a
//     destination, or a color, so the loose-appearance rule holds.
//   - HOW MANY images one gem is made of. A `plain` gem is one sprite; a
//     `brilliant` or a `star` is that sprite plus the treatment "drawn as
//     overlays composited over a kind's sprite", so it is two. The assertion is
//     an at-least, and a build that spends more images per gem than the minimum
//     passes by more.
//   - WHETHER THE SPRITES SHARE A FILE. The count is of DRAWS, never of files or
//     of distinct sources, so a build that packs its stones into one image and
//     blits each gem out of it with a source rectangle issues the same sixty-four
//     draws a build with one PNG per sprite issues, and clears the same bar.
//   - WHERE THE GEMS ARE. No draw is matched to a cell: a build is free to
//     translate the context, to scale the stage, or to paint its board in any
//     order it likes.
//
// WHY `drawImage` IS THE SIGNAL. It is the one operation that puts a loaded image
// on the surface, and it is in the harness's own `DRAW_METHODS` for this reason.
// The check reads the operation and not the pixels: what a build hands
// `drawImage` is beyond this item, and whether the produced art is really there
// is `assets/gem-sprites-produced`'s and the appearance items' to decide.
//
// WHY THE FRAME IS WAITED FOR RATHER THAN TAKEN AT ONCE. specs/assets.md has
// every produced file loaded at run time, and nothing in the specification says
// a build must hold its first frame until they arrive — a build that draws a
// placeholder while its sprites decode is conformant. So the check drives frames
// over a bounded stretch of real time and asks whether a frame of the playing
// screen ever draws the board from images, and it is the never that fails.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { quietBoard } from "../board";
import { GRID_COLS, GRID_ROWS } from "../constants";
import {
  callsTo,
  captureStill,
  createHarness,
  failSurface,
  loadBoard,
  type DrawCall,
  type Harness,
} from "../harness";

/** One image draw for every gem a settled board holds: `specs/board.md`. */
const GEMS_ON_A_SETTLED_BOARD = GRID_COLS * GRID_ROWS;

/** How long the produced sprites are given to arrive, and how often a frame asks. */
const LOAD_BUDGET_MS = 5_000;
const POLL_MS = 100;

let h: Harness;

function requireSurface(): void {
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);
}

/** How many images the frame these calls came from put on the surface. */
function imageDraws(calls: readonly DrawCall[]): number {
  return callsTo(calls, "drawImage").length;
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws every gem on the board from an image", async () => {
  requireSurface();
  // Any full board answers this: what is read is the render, and the run-free
  // filler puts a gem in all sixty-four cells without setting anything off.
  const posed = await loadBoard(h, quietBoard());
  assertEqual(posed.screen, "playing", "the screen a posed board stands on");

  // One frame at a time, until the produced files have had their chance.
  let calls: DrawCall[] = await h.frameCalls();
  for (
    let waited = 0;
    imageDraws(calls) < GEMS_ON_A_SETTLED_BOARD && waited < LOAD_BUDGET_MS;
    waited += POLL_MS
  ) {
    await h.settle(POLL_MS);
    calls = await h.frameCalls();
  }
  await captureStill(h, "frame");

  assertGreaterThanOrEqual(
    imageDraws(calls),
    GEMS_ON_A_SETTLED_BOARD,
    "image draws in a frame of the settled playing board",
  );
});
