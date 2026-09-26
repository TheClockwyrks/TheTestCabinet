// assets/mote-sprites-exist — the fifteen mote sprites are produced.
//
// THE RULE, from the sprite table of `specs/assets.md` (The sprites): "Motes —
// `assets/sprites/motes/<type>.png`, one for each of the fifteen names in
// `MOTES`". Where the files land fixes where that path is rooted: "Every produced
// file sits under `assets/` at the root of this repository, at the path named
// below, and is committed."
//
// WHY THE PATH IS THE WHOLE POINT. "Orrery ships with no pre-made art and no
// pre-made sound ... every sprite, sheet, glyph, effect, cue, and the music bed
// the game shows or plays is produced with them during this build, committed to
// the repository, and bundled by it." The build asks its loader for the path its
// row names — `MOTE_SPRITE_PATHS` holds exactly those fifteen — so a mote drawn
// from a file under a name of the build's own choosing is a mote the game cannot
// reach, and nothing at another path stands in for the one the row names.
//
// WHAT THIS POINT DOES NOT READ. Whether a file decodes, at what canvas, and what
// it carries are the three points after this one. This one reads that the fifteen
// files are there, at those paths.
//
// THE EVIDENCE is the produced files themselves, magnified over a checkerboard, so
// a reviewer sees which of the fifteen turned up.

import { it } from "vitest";
import { assertLength, assertNotNull } from "../assert";
import { MOTES } from "../constants";
import { MOTE_SPRITES } from "./files";
import { showSprites, spriteBytes } from "./sprites";

it("produces a file at each of the fifteen mote sprite paths", async () => {
  await showSprites("motes", MOTE_SPRITES);

  assertLength(
    MOTE_SPRITES,
    MOTES.length,
    "one path per name in MOTES, so the reading below is fifteen files rather than none",
  );
  for (const row of MOTE_SPRITES) {
    assertNotNull(
      spriteBytes(row.file),
      `the produced ${row.label} at ${row.file}`,
    );
  }
});
