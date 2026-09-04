// assets/sprites-on-transparent-ground — the sprites are drawings on bare
// canvas, not plates.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The sprites"): "Every sprite
// is pixel art drawn at one unit per pixel on a transparent, straight-alpha
// canvas of exactly the size its row states ... Each is drawn centered on the
// thing it depicts." A thing drawn centered on a square canvas leaves canvas bare
// around it, and the game draws every one of them over the night with the ground
// showing through, so what is read off the committed pixels is that each file
// decodes with an alpha channel and carries at least one fully transparent pixel.
//
// STRAIGHT ALPHA IS THE PNG'S OWN STORAGE. A PNG stores un-premultiplied RGBA, so
// a file that decodes as a PNG carrying transparency IS a straight-alpha canvas;
// a premultiplied export leaves no signature separable from a sprite drawn with
// hard edges, so nothing beyond that is claimed here.
//
// THE GROUND TILE IS NOT AMONG THEM. specs/assets.md makes it the ground itself —
// "The ground tile sits flush against itself on all four sides, since the ground
// is that tile repeated across the world" — so it is the background rather than
// something drawn over one, and the requirement's own reason ("so none of them
// relies on a background behind it") does not reach it. Its file is read by
// `assets/ground-tile-produced` instead.
//
// THE TOLERANCE. None on the transparent pixel: an alpha of exactly `0` is bare
// canvas, and one such pixel is the least a drawing centered on its canvas can
// leave. How MUCH canvas a sprite leaves bare is the art bar and the presentation
// domain's aesthetic rating.
//
// THE DRIVE. None. This point is about FILES, so it reads the repository the
// build produced and drives no game.

import { it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { writeImage } from "./media-out";
import {
  ALL_SPRITES,
  clearPixels,
  decodeAll,
  GROUND_SPRITE,
  paintSprites,
} from "./sprites";

/** Every produced sprite and sheet frame drawn over the night, the ground apart. */
const OVER_THE_NIGHT = ALL_SPRITES.filter(
  (sprite) => sprite.file !== GROUND_SPRITE.file,
);

it("leaves bare canvas on every sprite drawn over the night", async () => {
  // Painted before anything is read, so a file that will not decode still leaves
  // the picture that shows what the build shipped.
  writeImage(
    "checkerboard",
    await paintSprites("Every sprite over a checkerboard", OVER_THE_NIGHT, {
      checker: true,
      columns: 14,
      cell: 72,
    }),
  );

  for (const sprite of await decodeAll(OVER_THE_NIGHT)) {
    assertGreaterThanOrEqual(
      clearPixels(sprite),
      1,
      `fully transparent pixels on ${sprite.file} — a sprite that relies on a background behind it has none`,
    );
  }
});
