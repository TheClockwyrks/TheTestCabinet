// assets/instruction-glyphs-exist — the ten instruction glyphs are produced.
//
// THE RULE, from the sprite table of `specs/assets.md` (The sprites): "Instruction
// glyphs — `assets/sprites/instructions/<name>.png`, one for each of the ten names
// in `INSTRUCTIONS`". Where the files land roots that path: "Every produced file
// sits under `assets/` at the root of this repository, at the path named below,
// and is committed."
//
// WHY THE PATH IS THE WHOLE POINT. "Orrery ships with no pre-made art and no
// pre-made sound ... every sprite, sheet, glyph, effect, cue, and the music bed
// the game shows or plays is produced with them during this build, committed to
// the repository, and bundled by it." The build asks its loader for the path its
// row names — `INSTRUCTION_GLYPH_PATHS` holds exactly those ten, one per name in
// `INSTRUCTIONS` — so a glyph committed under another name is a glyph the tape
// panel cannot reach. The panel's rows, cells and cursor are What stays drawn in
// code; the mark inside a cell is one of these ten files.
//
// WHAT THIS POINT DOES NOT READ. Whether a file decodes, at what canvas, and what
// it carries are the three points after this one.
//
// THE EVIDENCE is the produced files, magnified over a checkerboard, so a reviewer
// sees which of the ten turned up.

import { it } from "vitest";
import { assertLength, assertNotNull } from "../assert";
import { INSTRUCTIONS } from "../constants";
import { INSTRUCTION_SPRITES } from "./files";
import { showSprites, spriteBytes } from "./sprites";

it("produces a file at each of the ten instruction glyph paths", async () => {
  await showSprites("instructions", INSTRUCTION_SPRITES);

  assertLength(
    INSTRUCTION_SPRITES,
    INSTRUCTIONS.length,
    "one path per name in INSTRUCTIONS, so the reading below is ten files rather than none",
  );
  for (const row of INSTRUCTION_SPRITES) {
    assertNotNull(
      spriteBytes(row.file),
      `the produced ${row.label} at ${row.file}`,
    );
  }
});
