// assets/rise-frames-distinct — the six rise frames differ from one another.
//
// THE RULE, from the sheets of `specs/assets.md`: "The six frames are six stages
// of one turn, advancing by an equal step through exactly one period of the
// aperture's own motif: frame `5` runs back into frame `0`, and NO TWO FRAMES OF
// A SHEET ARE THE SAME IMAGE." The sheet is played for that reason — each rise on
// the field "draws frame `floor(state.simTime / APERTURE_FRAME_TIME) mod
// APERTURE_FRAMES` of its own sheet ... so both apertures turn continuously" — and
// a sheet whose frames repeat turns through less than the period, however fast it
// is indexed.
//
// WHAT IT READS. Every one of the fifteen pairs differs somewhere on the `48 x
// 48` canvas the two share. One frame shipped six times differs by exactly
// nothing, since a PNG carries its pixels losslessly, so any pixel of
// difference is the whole of the reading. Two clear pixels count as the same
// pixel whatever bytes sit under them, because a straight-alpha canvas leaves
// those bytes undefined and a player sees nothing either way.
//
// WHAT IT DOES NOT DECIDE. Whether the step between the six is an equal one through
// exactly one period of the motif, and whether the turn reads as continuous rather
// than as a flicker, are the art bar's own and the reviewer's judgement. This point
// decides the half a file answers: six pictures were drawn rather than one repeated.
//
// THE EVIDENCE is the six frames in order, magnified, so the turn is followed by eye
// beside the verdict.

import { it } from "vitest";
import { assertGreaterThan, assertLength, fail } from "../assert";
import { APERTURE_FRAMES } from "../constants";
import { RISE_SPRITES } from "./files";
import {
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
      assertGreaterThan(
        differingShare(frames[i], frames[j]),
        0,
        `${RISE_SPRITES[i].label} against ${RISE_SPRITES[j].label}: the share of the canvas that differs`,
      );
    }
  }
});
