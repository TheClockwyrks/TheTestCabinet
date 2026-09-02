// assets/aperture-frames-on-transparent-ground — the sheet frames are authored on
// transparency.
//
// THE RULE, from The sheets of `specs/assets.md`: the two sheets are "emitted as
// separate PNGs numbered from `0` rather than as regions of one image, each frame on
// a transparent, straight-alpha canvas of exactly the size its row states." The art
// bar says what that buys: "Every sprite reads on the dark sky, and none of them
// relies on a background behind it." An aperture is composited onto the field every
// frame — each rise and each set "draws frame `floor(state.simTime /
// APERTURE_FRAME_TIME) mod APERTURE_FRAMES` of its own sheet, centered on its anchor
// hex, under the pattern the build draws in code" — so a frame carrying a baked
// ground blots out the hex beneath it, and the pattern drawn over it has nothing of
// the field left to sit against.
//
// WHICH FRAMES. All twelve: the rise sheet's six and the set sheet's six.
//
// WHAT IT READS. Every frame decodes, and at least `GROUND_MIN_SHARE` of its canvas
// is clear — alpha at or below `GROUND_ALPHA`. `specs/assets.md` fixes no coverage
// figure, and a frame drawn right out to the edge of its canvas is conformant, so the
// floor is deliberately low at one twentieth: what it catches is a canvas that was
// FLOODED, which is the failure the requirement is about. A frame whose every pixel
// is opaque cannot clear it however it was drawn.
//
// WHAT IT DOES NOT DECIDE. Whether the alpha is STRAIGHT rather than premultiplied is
// not readable from a decoded canvas, which hands back straight-alpha bytes whatever
// the file stored; and whether the turn READS as an entrance or an exit is the art
// bar itself, and the reviewer's judgement.
//
// THE EVIDENCE is all twelve frames magnified over a checkerboard: wherever the
// checker shows through, that frame was transparent there.

import { it } from "vitest";
import { assertGreaterThanOrEqual, assertLength, fail } from "../assert";
import { APERTURE_FRAMES } from "../constants";
import { RISE_SPRITES, SET_SPRITES } from "./files";
import {
  GROUND_MIN_SHARE,
  decodeProduced,
  groundShare,
  showSprites,
} from "./sprites";

/** Both sheets' frames, each sheet in frame order. */
const FRAMES = [...RISE_SPRITES, ...SET_SPRITES];

it("leaves clear ground on every one of the twelve aperture frames", async () => {
  await showSprites("checkerboard", FRAMES);

  assertLength(
    FRAMES,
    APERTURE_FRAMES * 2,
    "the frames of both sheets, so the sweep below is twelve files rather than none",
  );
  const readings = await decodeProduced(FRAMES);
  for (const [index, row] of FRAMES.entries()) {
    const read = readings[index];
    if (read.sprite === null) fail(`a decoded ${row.label}`, read.reason);
    assertGreaterThanOrEqual(
      groundShare(read.sprite),
      GROUND_MIN_SHARE,
      `${row.label}: the share of its canvas left as clear ground`,
    );
  }
});
