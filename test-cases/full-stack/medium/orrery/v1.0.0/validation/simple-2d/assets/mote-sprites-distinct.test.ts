// assets/mote-sprites-distinct — the fifteen mote sprites differ from one another.
//
// THE RULE, from the art bar of `specs/assets.md`: "The fifteen mote sprites are
// pairwise distinguishable on the field without reading a label, and the six
// planets read as one family whose rungs run in the ladder order of `PLANETS`."
// The Motes row names one file per type for the same reason: fifteen types of mote
// sit on one field at once, and a player tells a `sol` from a `dust` by its
// picture.
//
// WHAT IT READS. Every one of the hundred and five pairs differs on at least
// `DIFFER_MIN_SHARE` of the canvas the two share. A file shipped fifteen times
// differs by exactly nothing, since a PNG carries its pixels losslessly, so the
// floor is one hundredth — the smallest share worth calling measurable. Two clear
// pixels count as the same pixel whatever bytes sit under them, because a
// straight-alpha canvas leaves those bytes undefined and a player sees nothing
// either way.
//
// WHAT IT DOES NOT DECIDE. Whether a pair is distinguishable AT A GLANCE, and
// whether the six planets read as one ladder, are the art bar itself and are the
// reviewer's judgement. This point decides only that fifteen pictures were drawn
// rather than one repeated.
//
// THE EVIDENCE is the fifteen files side by side, magnified, so the pairs are
// compared by eye beside the verdict.

import { it } from "vitest";
import { assertGreaterThanOrEqual, assertLength, fail } from "../assert";
import { MOTES } from "../constants";
import { MOTE_SPRITES } from "./files";
import {
  DIFFER_MIN_SHARE,
  type Sprite,
  decodeProduced,
  differingShare,
  showSprites,
} from "./sprites";

it("draws a picture of its own for each of the fifteen motes", async () => {
  await showSprites("motes", MOTE_SPRITES);

  assertLength(
    MOTE_SPRITES,
    MOTES.length,
    "one path per name in MOTES, so the pairs below are the fifteen sprites'",
  );
  const readings = await decodeProduced(MOTE_SPRITES);
  const sprites: Sprite[] = [];
  for (const [index, row] of MOTE_SPRITES.entries()) {
    const read = readings[index];
    if (read.sprite === null) fail(`a decoded ${row.label}`, read.reason);
    sprites.push(read.sprite);
  }

  for (let i = 0; i < sprites.length; i += 1) {
    for (let j = i + 1; j < sprites.length; j += 1) {
      assertGreaterThanOrEqual(
        differingShare(sprites[i], sprites[j]),
        DIFFER_MIN_SHARE,
        `${MOTE_SPRITES[i].label} against ${MOTE_SPRITES[j].label}: the share of the canvas that differs`,
      );
    }
  }
});
