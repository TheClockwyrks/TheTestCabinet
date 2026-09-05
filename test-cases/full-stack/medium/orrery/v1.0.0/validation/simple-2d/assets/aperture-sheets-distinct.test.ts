// assets/aperture-sheets-distinct — the set sheet differs from the rise sheet.
//
// THE RULE, from the art bar of `specs/assets.md`: "The rise aperture reads as an
// entrance and the set aperture as an exit." The sheets table names two sheets for
// that reason, and `specs/parts.md`'s two apertures sit on the same field at once —
// "Each rise and each set on the field draws frame `floor(state.simTime /
// APERTURE_FRAME_TIME) mod APERTURE_FRAMES` of its own sheet, centered on its anchor
// hex" — so both are indexed by the same clock and turn in step. One sheet copied
// into both directories leaves an entrance and an exit showing the same picture at
// every moment of every turn.
//
// WHY FRAME AGAINST FRAME. Both sheets are indexed by `state.simTime`, so at every
// moment the frame a rise shows and the frame a set shows carry the same number. The
// pair a player has in front of them is therefore frame `i` against frame `i`, and
// that is the comparison this point makes, for each `i` from `0` to
// `APERTURE_FRAMES - 1`.
//
// WHAT IT READS. Each of those six pairs differs somewhere on the `48 x 48`
// canvas the two share. A file shipped under both names differs by exactly
// nothing, since a PNG carries its pixels losslessly, so any pixel of
// difference is the whole of the reading. Two clear pixels count as the same
// pixel whatever bytes sit under them, because a straight-alpha canvas leaves
// those bytes undefined and a player sees nothing either way.
//
// WHAT IT DOES NOT DECIDE. Whether one READS AS AN ENTRANCE and the other AS AN EXIT
// is the art bar itself, and the reviewer's judgement. This point decides that two
// sheets were drawn rather than one shipped twice.
//
// THE EVIDENCE is the rise sheet's six frames and the set sheet's six frames,
// magnified, so the two turns are compared by eye beside the verdict.

import { it } from "vitest";
import { assertGreaterThan, assertLength, fail } from "../assert";
import { APERTURE_FRAMES } from "../constants";
import { RISE_SPRITES, SET_SPRITES } from "./files";
import {
  type Sprite,
  decodeProduced,
  differingShare,
  showSprites,
} from "./sprites";

it("draws the set sheet as a different turn from the rise sheet", async () => {
  await showSprites("sheets", [...RISE_SPRITES, ...SET_SPRITES]);

  assertLength(
    RISE_SPRITES,
    APERTURE_FRAMES,
    "one path per frame the Rise aperture row states, so the pairs below are frame against frame",
  );
  assertLength(
    SET_SPRITES,
    APERTURE_FRAMES,
    "one path per frame the Set aperture row states, so the pairs below are frame against frame",
  );

  const readRise = await decodeProduced(RISE_SPRITES);
  const readSet = await decodeProduced(SET_SPRITES);
  const rise: Sprite[] = [];
  const set: Sprite[] = [];
  for (const [index, row] of RISE_SPRITES.entries()) {
    const read = readRise[index];
    if (read.sprite === null) fail(`a decoded ${row.label}`, read.reason);
    rise.push(read.sprite);
  }
  for (const [index, row] of SET_SPRITES.entries()) {
    const read = readSet[index];
    if (read.sprite === null) fail(`a decoded ${row.label}`, read.reason);
    set.push(read.sprite);
  }

  for (let frame = 0; frame < APERTURE_FRAMES; frame += 1) {
    assertGreaterThan(
      differingShare(rise[frame], set[frame]),
      0,
      `${RISE_SPRITES[frame].label} against ${SET_SPRITES[frame].label}: the share of the canvas that differs`,
    );
  }
});
