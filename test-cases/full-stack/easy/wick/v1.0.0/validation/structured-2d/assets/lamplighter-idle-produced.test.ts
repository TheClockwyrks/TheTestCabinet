// assets/lamplighter-idle-produced — the lamplighter's idle sprite is a
// committed file on its stated canvas, carrying paint.
//
// WHAT THIS DECIDES. One file: `assets/sprites/lamplighter/idle.png` is
// committed, decodes as a picture, sits on exactly `24 x 32`, and carries
// non-transparent paint rather than being a blank canvas.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The sprites"): the table
// puts "Lamplighter, idle" at "`assets/sprites/lamplighter/idle.png`",
// produced with `draw`, `1` frame, on a `24 x 32` canvas, and the paragraph
// above it fixes the canvas exactly — "Every sprite is pixel art drawn at one
// unit per pixel on a transparent, straight-alpha canvas of exactly the size
// its row states, so a sprite `24` pixels wide stands `24` units wide in the
// world". `LAMPLIGHTER_IDLE_PATH`, `LAMPLIGHTER_SPRITE_WIDTH` and
// `LAMPLIGHTER_SPRITE_HEIGHT` in `src/constants.ts` are those same figures.
//
// WHAT IT DELIBERATELY DOES NOT READ. That the file is authored on
// transparency is `assets/sprites-on-transparent-ground`; that the game draws
// the lamplighter FROM it on a still tick belongs to the lamplighter's own
// presentation points; and whether the figure reads as a lamplighter is the
// art bar and the presentation domain's aesthetic rating.
//
// WHY NO WORLD IS POSED. This point is about a FILE rather than about a
// frame, so no scenario is staged and the game is never driven: the committed
// bytes are read off disk and decoded by the canvas this project already runs
// the engine on (see `assets/produced.ts`). A harness is opened only to own
// the canvas the evidence picture is painted on, and the picture is the file
// itself, magnified.
//
// THE TOLERANCE. The canvas is exact, because the specification states it
// exactly. The paint reading is presence: the specification fixes no coverage
// figure, so the only honest reading is the line between a drawn picture and an
// empty file.

import { afterEach, beforeEach, it } from "vitest";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  assertProduced,
  LAMPLIGHTER_IDLE,
  readSprites,
  showSprites,
} from "./produced";

const FILES = [LAMPLIGHTER_IDLE];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("commits the idle lamplighter as a painted 24 x 32 sprite", async () => {
  const reads = await readSprites(FILES);
  await showSprites(h, FILES);
  captureStill(h, "idle");

  assertProduced(reads);
});
