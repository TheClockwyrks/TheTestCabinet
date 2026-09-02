// assets/sigil-glyphs-exist — the twelve sigil glyphs are produced.
//
// THE RULE, from the sprite table of `specs/assets.md` (The sprites): "Sigil
// glyphs — `assets/sprites/sigils/<kind>.png`, one for each of the twelve
// transforming sigils of `PARTS`". Where the files land roots that path: "Every
// produced file sits under `assets/` at the root of this repository, at the path
// named below, and is committed."
//
// WHICH TWELVE. The transforming sigils of `PARTS`, `bind` through `void` —
// `TRANSFORMING_SIGILS`. `rise` and `set` are sigils too, but neither carries a
// produced glyph: what they show is "the reagent pattern a rise shows and the
// product pattern a set shows", which What stays drawn in code hands to the build's
// own rendering, and their apertures are sheets rather than glyphs.
//
// WHY THE PATH IS THE WHOLE POINT. "Orrery ships with no pre-made art and no
// pre-made sound ... every sprite, sheet, glyph, effect, cue, and the music bed
// the game shows or plays is produced with them during this build, committed to
// the repository, and bundled by it." The build asks its loader for the path its
// row names — `SIGIL_GLYPH_PATHS` holds exactly those twelve — so a glyph
// committed under another name is a glyph the game cannot reach.
//
// WHAT THIS POINT DOES NOT READ. Whether a file decodes, at what canvas, and what
// it carries are the three points after this one.
//
// THE EVIDENCE is the produced files, magnified over a checkerboard, so a reviewer
// sees which of the twelve turned up.

import { it } from "vitest";
import { assertLength, assertNotNull } from "../assert";
import { TRANSFORMING_SIGILS } from "../constants";
import { SIGIL_SPRITES } from "./files";
import { showSprites, spriteBytes } from "./sprites";

it("produces a file at each of the twelve sigil glyph paths", async () => {
  await showSprites("sigils", SIGIL_SPRITES);

  assertLength(
    SIGIL_SPRITES,
    TRANSFORMING_SIGILS.length,
    "one path per transforming sigil of PARTS, so the reading below is twelve files rather than none",
  );
  for (const row of SIGIL_SPRITES) {
    assertNotNull(
      spriteBytes(row.file),
      `the produced ${row.label} at ${row.file}`,
    );
  }
});
