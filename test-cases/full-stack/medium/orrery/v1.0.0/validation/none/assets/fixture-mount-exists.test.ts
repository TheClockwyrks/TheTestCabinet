// assets/fixture-mount-exists — the fixture mount is produced.
//
// THE RULE, from the sprite table of `specs/assets.md` (The sprites): "Fixture
// mount — `assets/sprites/parts/fixture-mount.png`", drawn "centered on each
// fixture's hex, beneath its mote sprite". Where the files land roots that path:
// "Every produced file sits under `assets/` at the root of this repository, at the
// path named below, and is committed."
//
// WHY THE PATH IS THE WHOLE POINT. "Orrery ships with no pre-made art and no
// pre-made sound ... every sprite, sheet, glyph, effect, cue, and the music bed the
// game shows or plays is produced with them during this build, committed to the
// repository, and bundled by it." The build asks its loader for the path its row
// names — `FIXTURE_MOUNT_PATH` is exactly that one — so a mount committed under
// another name is a mount the game cannot reach, and the art bar's "A fixture reads
// as mounted on its wheel rather than as resting loose" has nothing to read it off.
//
// WHAT THIS POINT DOES NOT READ. Whether the file decodes, at what canvas, and what
// it carries are the two points after this one and the comparison against the wheel
// hub.
//
// THE EVIDENCE is the produced file, magnified over a checkerboard.

import { it } from "vitest";
import { assertLength, assertNotNull } from "../assert";
import { FIXTURE_MOUNT_PATH } from "../constants";
import { WHEEL_SPRITES, assetFile } from "./files";
import { showSprites, spriteBytes } from "./sprites";

const MOUNT = WHEEL_SPRITES.filter(
  (row) => row.file === assetFile(FIXTURE_MOUNT_PATH),
);

it("produces a file at the fixture mount's path", async () => {
  await showSprites("mount", MOUNT);

  assertLength(
    MOUNT,
    1,
    "the fixture mount's row of the produced table, so the reading below is a file rather than none",
  );
  assertNotNull(
    spriteBytes(MOUNT[0].file),
    `the produced ${MOUNT[0].label} at ${MOUNT[0].file}`,
  );
});
