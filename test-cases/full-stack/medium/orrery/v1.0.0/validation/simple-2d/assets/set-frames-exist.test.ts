// assets/set-frames-exist — the set aperture ships six numbered frames.
//
// THE RULE, from The sheets of `specs/assets.md`: "Two sheets, produced with
// `draw-sheet` and emitted as separate PNGs numbered from `0` rather than as
// regions of one image, each frame on a transparent, straight-alpha canvas of
// exactly the size its row states." The Set aperture row names them —
// "`assets/sprites/apertures/set/0.png` to `5.png`", `6` frames — and Where the
// files land roots the path: "Every produced file sits under `assets/` at the root
// of this repository, at the path named below, and is committed."
//
// WHY SEPARATE FILES, AND WHY NUMBERED FROM ZERO. The build reaches a frame by its
// number: each set on the field "draws frame `floor(state.simTime /
// APERTURE_FRAME_TIME) mod APERTURE_FRAMES` of its own sheet", and that index runs
// `0` through `APERTURE_FRAMES - 1`. A sheet packed as regions of one image, or
// numbered from `1`, is a sheet the build cannot index, and `APERTURE_SHEETS.set`
// is the directory the numbering sits under.
//
// WHAT THIS POINT DOES NOT READ. Whether the six files decode, at what canvas, what
// they carry, and whether they differ are the three points after this one.
//
// THE EVIDENCE is the six produced files in frame order, magnified over a
// checkerboard, so a reviewer sees which of the six turned up.

import { it } from "vitest";
import { assertLength, assertNotNull } from "../assert";
import { APERTURE_FRAMES } from "../constants";
import { SET_SPRITES } from "./files";
import { showSprites, spriteBytes } from "./sprites";

it("produces a file at each of the six set aperture frame paths", async () => {
  await showSprites("set", SET_SPRITES);

  assertLength(
    SET_SPRITES,
    APERTURE_FRAMES,
    "one path per frame the Set aperture row states, so the reading below is six files rather than none",
  );
  for (const row of SET_SPRITES) {
    assertNotNull(
      spriteBytes(row.file),
      `the produced ${row.label} at ${row.file}`,
    );
  }
});
