// assets/ground-tile-produced — the ground tile is on disk, on its 64-pixel
// square, with ground drawn on it.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The sprites") gives the row
// "Ground tile | `assets/sprites/ground.png` | `draw` | `1` | `64 x 64`", under
// "Every sprite is pixel art drawn at one unit per pixel on a transparent,
// straight-alpha canvas of exactly the size its row states, so a sprite `24`
// pixels wide stands `24` units wide in the world" — so the tile stands `64`
// units square in the world, and "The ground tile sits flush against itself on
// all four sides, since the ground is that tile repeated across the world."
//
// THE TOLERANCES. The path and the `64 x 64` canvas are exact figures and are
// read exactly. That the file carries a drawing rather than an empty canvas is
// read as presence: at least one pixel of the canvas is not clear.
//
// WHAT IT DELIBERATELY DOES NOT READ. That the ground is drawn as this tile
// repeated in world space, so the lamplighter's motion reads against it, is the
// presentation category's; whether the tile sits flush against itself without a
// visible seam is the art bar and the presentation domain's aesthetic rating.
//
// THE DRIVE. None. This point is about a FILE, so it reads the repository the
// build produced and drives no game.

import { it } from "vitest";
import { writeImage } from "./media-out";
import {
  assertProducedAt,
  decodeSprite,
  GROUND_SPRITE,
  paintSprites,
} from "./sprites";

it("ships the ground tile as a painted 64 x 64 file", async () => {
  const read = await decodeSprite(GROUND_SPRITE.file);
  writeImage(
    "ground",
    await paintSprites("The ground tile", [GROUND_SPRITE], { cell: 256 }),
  );

  assertProducedAt(GROUND_SPRITE, read);
});
