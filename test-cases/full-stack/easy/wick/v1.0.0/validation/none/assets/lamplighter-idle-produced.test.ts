// assets/lamplighter-idle-produced — the idle sprite is on disk, on its canvas,
// with a lamplighter drawn on it.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The sprites") gives the row
// "Lamplighter, idle | `assets/sprites/lamplighter/idle.png` | `draw` | `1` |
// `24 x 32`", under "Every sprite is pixel art drawn at one unit per pixel on a
// transparent, straight-alpha canvas of exactly the size its row states, so a
// sprite `24` pixels wide stands `24` units wide in the world". The path and the
// canvas are exact figures, so they are read exactly; that the file carries a
// drawing rather than an empty canvas is read as presence: at least one pixel of
// the canvas is not clear.
//
// WHAT IT DELIBERATELY DOES NOT READ. That the idle sprite is drawn on the ticks
// the lamplighter is still is the presentation category's; that it reads as a
// lamplighter is the art bar and the presentation domain's aesthetic rating.
//
// THE DRIVE. None. This point is about a FILE, so it reads the repository the
// build produced and drives no game; the evidence is a picture of the file
// itself, magnified over a checkerboard so its transparency reads.

import { it } from "vitest";
import { writeImage } from "./media-out";
import {
  assertProducedAt,
  decodeSprite,
  IDLE_SPRITE,
  paintSprites,
} from "./sprites";

it("ships the lamplighter's idle sprite as a painted 24 x 32 file", async () => {
  const read = await decodeSprite(IDLE_SPRITE.file);
  writeImage(
    "idle",
    await paintSprites("The idle sprite", [IDLE_SPRITE], {
      checker: true,
      cell: 192,
    }),
  );

  assertProducedAt(IDLE_SPRITE, read);
});
