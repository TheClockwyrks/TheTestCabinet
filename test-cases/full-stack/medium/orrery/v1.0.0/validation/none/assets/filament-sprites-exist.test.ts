// assets/filament-sprites-exist — both filament strips are produced.
//
// THE RULE, from the sprite table of `specs/assets.md` (The sprites): "Filaments —
// `assets/sprites/filaments/plain.png`, `triune.png`". Two files, because a
// filament is drawn at one of two weights: `FILAMENT_SPRITE_PATHS` holds the plain
// strip for a join of weight `1` and the triune strip for one of weight `3`.
// Where the files land roots both: "Every produced file sits under `assets/` at
// the root of this repository, at the path named below, and is committed."
//
// WHY THE PATH IS THE WHOLE POINT. "Orrery ships with no pre-made art and no
// pre-made sound ... every sprite, sheet, glyph, effect, cue, and the music bed
// the game shows or plays is produced with them during this build, committed to
// the repository, and bundled by it." The build asks its loader for the path its
// row names, so a strip committed under any other name is a strip the game cannot
// reach.
//
// WHAT THIS POINT DOES NOT READ. Whether either file decodes, at what canvas, and
// what it carries are the three points after this one.
//
// THE EVIDENCE is the two produced files, magnified over a checkerboard.

import { it } from "vitest";
import { assertLength, assertNotNull } from "../assert";
import { FILAMENT_SPRITES } from "./files";
import { showSprites, spriteBytes } from "./sprites";

it("produces a file at both filament strip paths", async () => {
  await showSprites("strips", FILAMENT_SPRITES);

  assertLength(
    FILAMENT_SPRITES,
    2,
    "the plain strip and the triune strip, so the reading below is two files rather than none",
  );
  for (const row of FILAMENT_SPRITES) {
    assertNotNull(
      spriteBytes(row.file),
      `the produced ${row.label} at ${row.file}`,
    );
  }
});
