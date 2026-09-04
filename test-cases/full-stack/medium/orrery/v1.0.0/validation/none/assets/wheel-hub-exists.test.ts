// assets/wheel-hub-exists — the wheel hub is produced.
//
// THE RULE, from the sprite table of `specs/assets.md` (The sprites): "Wheel hub —
// `assets/sprites/parts/wheel-hub.png`", drawn "centered on the wheel's anchor hex
// and turned to the wheel's live rotation". Where the files land roots that path:
// "Every produced file sits under `assets/` at the root of this repository, at the
// path named below, and is committed."
//
// WHY THE PATH IS THE WHOLE POINT. "Orrery ships with no pre-made art and no
// pre-made sound ... every sprite, sheet, glyph, effect, cue, and the music bed the
// game shows or plays is produced with them during this build, committed to the
// repository, and bundled by it." The build asks its loader for the path its row
// names — `WHEEL_HUB_PATH` is exactly that one — so a hub committed under another
// name is a hub the game cannot reach, and a wheel's rotation is left to the spokes
// What stays drawn in code hands to the build.
//
// WHAT THIS POINT DOES NOT READ. Whether the file decodes, at what canvas, and what
// it carries are the two points after this one and the comparison against the
// fixture mount.
//
// THE EVIDENCE is the produced file, magnified over a checkerboard.

import { it } from "vitest";
import { assertLength, assertNotNull } from "../assert";
import { WHEEL_HUB_PATH } from "../constants";
import { WHEEL_SPRITES, assetFile } from "./files";
import { showSprites, spriteBytes } from "./sprites";

const HUB = WHEEL_SPRITES.filter(
  (row) => row.file === assetFile(WHEEL_HUB_PATH),
);

it("produces a file at the wheel hub's path", async () => {
  await showSprites("wheel-hub", HUB);

  assertLength(
    HUB,
    1,
    "the wheel hub's row of the produced table, so the reading below is a file rather than none",
  );
  assertNotNull(
    spriteBytes(HUB[0].file),
    `the produced ${HUB[0].label} at ${HUB[0].file}`,
  );
});
