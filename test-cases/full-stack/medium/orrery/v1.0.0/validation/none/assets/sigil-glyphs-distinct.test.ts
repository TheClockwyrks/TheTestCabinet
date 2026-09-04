// assets/sigil-glyphs-distinct — the twelve sigil glyphs differ from one another.
//
// THE RULE, from the art bar of `specs/assets.md`: "The twelve sigil glyphs are
// told apart from one another at `48` units." The Sigil glyphs row names one file
// per kind for that reason: a machine carries sigils of several kinds at once, and
// a player reads which transform sits on a hex off its engraving.
//
// WHAT IT READS. Every one of the sixty-six pairs differs on at least
// `DIFFER_MIN_SHARE` of the canvas the two share. One file shipped twelve times
// differs by exactly nothing, since a PNG carries its pixels losslessly, so the
// floor is one hundredth — the smallest share worth calling measurable. Two clear
// pixels count as the same pixel whatever bytes sit under them, because a
// straight-alpha canvas leaves those bytes undefined and a player sees nothing
// either way.
//
// WHAT IT DOES NOT DECIDE. Whether a pair is told apart AT `48` UNITS is the art
// bar itself, and the reviewer's judgement. This point decides that twelve
// engravings were drawn rather than one repeated.
//
// THE EVIDENCE is the twelve files side by side, magnified, so the pairs are
// compared by eye beside the verdict.

import { it } from "vitest";
import { assertGreaterThanOrEqual, assertLength, fail } from "../assert";
import { TRANSFORMING_SIGILS } from "../constants";
import { SIGIL_SPRITES } from "./files";
import {
  DIFFER_MIN_SHARE,
  type Sprite,
  decodeProduced,
  differingShare,
  showSprites,
} from "./sprites";

it("engraves a glyph of its own for each of the twelve transforming sigils", async () => {
  await showSprites("sigils", SIGIL_SPRITES);

  assertLength(
    SIGIL_SPRITES,
    TRANSFORMING_SIGILS.length,
    "one path per transforming sigil of PARTS, so the pairs below are the twelve glyphs'",
  );
  const readings = await decodeProduced(SIGIL_SPRITES);
  const glyphs: Sprite[] = [];
  for (const [index, row] of SIGIL_SPRITES.entries()) {
    const read = readings[index];
    if (read.sprite === null) fail(`a decoded ${row.label}`, read.reason);
    glyphs.push(read.sprite);
  }

  for (let i = 0; i < glyphs.length; i += 1) {
    for (let j = i + 1; j < glyphs.length; j += 1) {
      assertGreaterThanOrEqual(
        differingShare(glyphs[i], glyphs[j]),
        DIFFER_MIN_SHARE,
        `${SIGIL_SPRITES[i].label} against ${SIGIL_SPRITES[j].label}: the share of the canvas that differs`,
      );
    }
  }
});
