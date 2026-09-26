// assets/sprites-drawn — the board is drawn from images: a frame of the playing
// screen issues at least one image draw, so what is on the screen traces back to
// a produced file rather than being drawn entirely from shapes in code.
//
// WHAT THE SPECIFICATION SAYS. specs/assets.md opens its sprite section with
// "Every gem on the board is a produced sprite", produced one PNG at a time with
// `draw` and landed under `public/assets/gems/`, adds "The board frame, one
// sprite", and closes by naming the failure outright: a build that "draws its
// gems as code-drawn rounded rectangles ... has not met this contract, however
// exactly the rules are implemented".
//
// WHY PRESENCE, AND NOT A COUNT OR A POSITION. `drawImage` is the one operation
// that puts a loaded image on the surface, which is why the harness lists it
// among its `DRAW_METHODS`, and its PRESENCE on a frame of the playing screen is
// what this reads. A tighter reading would fail builds that are conformant:
//
//   - A COUNT of one image per gem assumes each stone is blitted on its own. A
//     build may composite its board however it likes — into an offscreen surface
//     it blits once, or in whatever passes it chooses — and specs/assets.md fixes
//     nothing about how the produced files reach the canvas.
//   - A POSITION, such as an image draw landing on a cell center, cannot be read
//     against a build that translates its context before drawing, which is
//     entirely legitimate and reports the offset coordinates on the call.
//
// So a build that puts no image on the screen at all fails here, and every build
// that draws from its produced art passes, whatever shape its render takes.
//
// WHAT DECIDES THE REST. Whether the produced sprites are there at all is
// `assets/gem-sprites-produced`, which reads the tree on disk; whether the drawn
// stones are told apart is the appearance items'; and whether every file the
// build asks for arrives is `assets/assets-load-page-relative`'s. Nothing here
// reads a source, a size, a destination, or a color.
//
// WHY ONE FRAME DECIDES IT. specs/assets.md makes the load part of
// initialization: "the game has not initialized until every load it starts has
// settled", and the debug surface every check drives through is reachable once
// the game has initialized. So by the time a board can be posed at all the
// sprites are in, and the frame that draws the posed board is the frame this
// reads.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { quietBoard } from "../board";
import {
  callsTo,
  captureStill,
  createHarness,
  failSurface,
  loadBoard,
  type DrawCall,
  type Harness,
} from "../harness";

/** The least a frame drawn from produced art can spend: one image draw. */
const REQUIRED_IMAGE_DRAWS = 1;

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
  await h.dispose();
});

it("draws the board from images rather than from shapes alone", async () => {
  requireSurface();
  // Any full board answers this: what is read is the render, and the run-free
  // filler puts a gem in all sixty-four cells without setting anything off.
  const posed = await loadBoard(h, quietBoard());
  assertEqual(posed.screen, "playing", "the screen a posed board stands on");

  // The frame that draws the posed board, and the operations it issued.
  const calls: DrawCall[] = await h.frameCalls();
  await captureStill(h, "frame");

  assertGreaterThanOrEqual(
    imageDraws(calls),
    REQUIRED_IMAGE_DRAWS,
    "image draws in a frame of the settled playing board",
  );
});
