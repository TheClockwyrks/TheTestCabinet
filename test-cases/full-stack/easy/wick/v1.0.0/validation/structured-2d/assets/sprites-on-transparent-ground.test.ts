// assets/sprites-on-transparent-ground — every sprite that stands on the
// ground is drawn on transparency, so none of them carries its own backdrop.
//
// WHAT THIS DECIDES. That each produced picture the game lays over the night
// — the lamplighter's idle sprite and six walk frames, all fifty-two enemy
// frames, the four puff frames, the three gems, the three pickups, every
// frame of all sixteen weapon effects, and the twenty-seven icons — decodes
// with an alpha channel and leaves at least one pixel of its canvas fully
// clear.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The sprites"): "Every
// sprite is pixel art drawn at one unit per pixel on a transparent,
// straight-alpha canvas of exactly the size its row states ... Each is drawn
// centered on the thing it depicts." A picture centered on the thing it
// depicts does not reach the corners of its canvas, so on a transparent
// canvas some of it stays clear; a file with no clear pixel anywhere is an
// opaque plate that brings its own backdrop and hides the night behind it.
//
// WHY THE GROUND TILE IS NOT IN THE SET. The same section makes the ground
// the one produced picture that is a backdrop: "The ground tile sits flush
// against itself on all four sides, since the ground is that tile repeated
// across the world." A tile whose face is the world's floor covers that face,
// and a clear pixel in it would be a hole in the ground, so the requirement
// this point reads is about the sprites that stand ON the ground rather than
// about the ground itself. `assets/ground-tile-produced` reads the tile.
//
// WHY STRAIGHT ALPHA IS NOT READ SEPARATELY. Straight alpha is the PNG
// container's own storage, so a file that decodes as a PNG with an alpha
// channel IS on a straight-alpha canvas; a premultiplied authoring leaves no
// signature in the decoded pixels that could be told from a picture whose
// colours happen to be dark, so there is nothing further a script can read
// here without failing conformant builds.
//
// WHY NO WORLD IS POSED. This point is about FILES rather than about a frame,
// so the game is never driven. A harness is opened only to own the canvas the
// evidence picture is painted on, and the picture is every sprite over a
// checkerboard: wherever the checker shows through, the canvas was clear.
//
// THE TOLERANCE. Fully clear is alpha exactly `0`, and one such pixel is
// enough. The specification fixes no share, and a single wholly transparent
// pixel is the smallest reading that separates a picture drawn on
// transparency from a plate drawn edge to edge.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  ALL_SPRITES,
  clearPixels,
  GROUND_TILE,
  readSprites,
  requireImages,
  showOverChecker,
} from "./produced";

/** Every produced sprite that is laid over the night rather than being it. */
const FILES = ALL_SPRITES.filter((sprite) => sprite.path !== GROUND_TILE.path);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves clear canvas in every sprite the game lays over the night", async () => {
  const reads = await readSprites(FILES);
  await showOverChecker(h, FILES);
  captureStill(h, "checkerboard");

  const images = requireImages(reads);
  for (let i = 0; i < images.length; i += 1) {
    assertGreaterThanOrEqual(
      clearPixels(images[i]),
      1,
      `fully transparent pixels in ${FILES[i].path}`,
    );
  }
});
