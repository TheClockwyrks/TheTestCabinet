// assets/gripper-sprites-exist — both gripper sprites are produced.
//
// THE RULE, from the sprite table of `specs/assets.md` (The sprites): "Grippers —
// `assets/sprites/parts/gripper-open.png`, `gripper-closed.png`". Two files,
// because the row hands each of a gripper's two states one of them: "the closed
// sprite while the gripper holds a mote and the open one whenever it holds none,
// so that whether a gripper is holding reads off the field as `specs/parts.md`
// asks". Where the files land roots both: "Every produced file sits under
// `assets/` at the root of this repository, at the path named below, and is
// committed."
//
// WHY THE PATH IS THE WHOLE POINT. "Orrery ships with no pre-made art and no
// pre-made sound ... every sprite, sheet, glyph, effect, cue, and the music bed
// the game shows or plays is produced with them during this build, committed to
// the repository, and bundled by it." The build asks its loader for the path its
// row names — `GRIPPER_PATHS` holds exactly those two — so a gripper committed
// under another name is a gripper the game cannot reach, and a build with only one
// of the two files cannot show a hold at all.
//
// WHAT THIS POINT DOES NOT READ. Whether either file decodes, at what canvas, and
// what it carries are the points after this one.
//
// THE EVIDENCE is the two produced files, magnified over a checkerboard.

import { it } from "vitest";
import { assertLength, assertNotNull } from "../assert";
import { GRIPPER_SPRITES } from "./files";
import { showSprites, spriteBytes } from "./sprites";

it("produces a file at both gripper paths", async () => {
  await showSprites("grippers", GRIPPER_SPRITES);

  assertLength(
    GRIPPER_SPRITES,
    2,
    "the open gripper and the closed one, so the reading below is two files rather than none",
  );
  for (const row of GRIPPER_SPRITES) {
    assertNotNull(
      spriteBytes(row.file),
      `the produced ${row.label} at ${row.file}`,
    );
  }
});
