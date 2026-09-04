// assets/hub-sprites-exist — both hub sprites are produced.
//
// THE RULE, from the sprite table of `specs/assets.md` (The sprites): "Arm hubs —
// `assets/sprites/parts/hub-arm.png`, `hub-piston.png`". Two files, because the
// row hands each of the five arm kinds one of them: "the arm hub carried by `arm`,
// `biarm`, `triarm`, and `hexarm`, the piston hub by `piston`". Where the files
// land roots both: "Every produced file sits under `assets/` at the root of this
// repository, at the path named below, and is committed."
//
// WHY THE PATH IS THE WHOLE POINT. "Orrery ships with no pre-made art and no
// pre-made sound ... every sprite, sheet, glyph, effect, cue, and the music bed
// the game shows or plays is produced with them during this build, committed to
// the repository, and bundled by it." The build asks its loader for the path its
// row names — `HUB_PATHS` holds exactly those two — so a hub committed under
// another name is a hub the game cannot reach. An arm's spokes and shaft are What
// stays drawn in code; the hub at its base is one of these two files.
//
// WHAT THIS POINT DOES NOT READ. Whether either file decodes, at what canvas, and
// what it carries are the three points after this one.
//
// THE EVIDENCE is the two produced files, magnified over a checkerboard.

import { it } from "vitest";
import { assertLength, assertNotNull } from "../assert";
import { HUB_SPRITES } from "./files";
import { showSprites, spriteBytes } from "./sprites";

it("produces a file at both arm hub paths", async () => {
  await showSprites("hubs", HUB_SPRITES);

  assertLength(
    HUB_SPRITES,
    2,
    "the arm hub and the piston hub, so the reading below is two files rather than none",
  );
  for (const row of HUB_SPRITES) {
    assertNotNull(
      spriteBytes(row.file),
      `the produced ${row.label} at ${row.file}`,
    );
  }
});
