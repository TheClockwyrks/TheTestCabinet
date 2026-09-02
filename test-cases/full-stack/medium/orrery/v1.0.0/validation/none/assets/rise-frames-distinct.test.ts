// assets/rise-frames-distinct — the six rise frames differ from one another.
//
// THE RULE, from the art bar of `specs/assets.md`: "The six frames of each aperture
// read as one continuous turn rather than a flicker." The sheet is played for that
// reason — each rise on the field "draws frame `floor(state.simTime /
// APERTURE_FRAME_TIME) mod APERTURE_FRAMES` of its own sheet ... so both apertures
// turn continuously" — and a sheet whose frames are all the same picture turns
// through nothing at all, however fast it is indexed.
//
// WHAT IT READS. Every one of the fifteen pairs differs on at least
// `DIFFER_MIN_SHARE` of the `48 x 48` canvas the two share. One frame shipped six
// times differs by exactly nothing, since a PNG carries its pixels losslessly, so the
// floor is one hundredth — the smallest share worth calling measurable. Two clear
// pixels count as the same pixel whatever bytes sit under them, because a
// straight-alpha canvas leaves those bytes undefined and a player sees nothing either
// way.
//
// WHAT IT DOES NOT DECIDE. Whether the six read as ONE CONTINUOUS TURN rather than a
// flicker is the art bar itself, and the reviewer's judgement. This point decides that
// six pictures were drawn rather than one repeated.
//
// THE EVIDENCE is the six frames in order, magnified, so the turn is followed by eye
// beside the verdict.

import { it } from "vitest";
import { assertGreaterThanOrEqual, assertLength, fail } from "../assert";
import { APERTURE_FRAMES } from "../constants";
import { RISE_SPRITES } from "./files";
import {
  DIFFER_MIN_SHARE,
  type Sprite,
  decodeProduced,
  differingShare,
  showSprites,
} from "./sprites";

it("draws a picture of its own for each of the six rise aperture frames", async () => {
  await showSprites("rise", RISE_SPRITES);

  assertLength(
    RISE_SPRITES,
    APERTURE_FRAMES,
    "one path per frame the Rise aperture row states, so the pairs below are the six frames'",
  );
  const readings = await decodeProduced(RISE_SPRITES);
  const frames: Sprite[] = [];
  for (const [index, row] of RISE_SPRITES.entries()) {
    const read = readings[index];
    if (read.sprite === null) fail(`a decoded ${row.label}`, read.reason);
    frames.push(read.sprite);
  }

  for (let i = 0; i < frames.length; i += 1) {
    for (let j = i + 1; j < frames.length; j += 1) {
      assertGreaterThanOrEqual(
        differingShare(frames[i], frames[j]),
        DIFFER_MIN_SHARE,
        `${RISE_SPRITES[i].label} against ${RISE_SPRITES[j].label}: the share of the canvas that differs`,
      );
    }
  }
});
