// assets/enemy-sheets-distinct — the thirteen enemies are thirteen drawings.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The sprites"): "Every enemy
// is told from every other at a glance, by silhouette and not by hue alone, and
// the two elites and the Dark read as larger and heavier than the commons." An
// enemy shipped as a copy of another's sheet is told from it by nothing at all,
// so the review item words the floor this point reads: no two of the thirteen
// enemies' `0.png` frames are pixel-identical.
//
// THE FIRST FRAME IS THE READING. Each sheet is compared through its own first
// frame, because that is the frame every enemy is drawn on when it spawns
// ("frame `floor(age / WALK_FRAME_TIME) mod 4`" at `age` `0`), and a set of
// sheets that differ only somewhere later in the cycle is not thirteen enemies
// told apart at a glance.
//
// THE TOLERANCE. None, and none is needed: a PNG carries its pixels losslessly,
// so two files holding one picture differ on exactly nothing. Sheets on
// different canvases — the elites' `56` and `72` and the Dark's `80` against the
// commons' — are wholly different by that alone, which is the specification's
// own "read as larger and heavier". How far apart two drawings must LOOK is the
// art bar and the presentation domain's aesthetic rating.
//
// THE DRIVE. None. This point is about FILES, so it reads the repository the
// build produced and drives no game.

import { it } from "vitest";
import { writeImage } from "./media-out";
import {
  assertAllDistinct,
  decodeAll,
  paintSprites,
  ROSTER_FIRST_FRAMES,
} from "./sprites";

it("draws each of the thirteen enemies differently from the rest", async () => {
  // Painted before anything is read, so a file that will not decode still leaves
  // the picture that shows what the build shipped.
  writeImage(
    "roster",
    await paintSprites(
      "The thirteen first frames side by side",
      ROSTER_FIRST_FRAMES,
      { checker: true, columns: 7, cell: 112 },
    ),
  );

  assertAllDistinct(await decodeAll(ROSTER_FIRST_FRAMES));
});
