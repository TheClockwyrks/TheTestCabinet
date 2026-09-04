// assets/instruction-glyphs-distinct — the ten instruction glyphs differ from one
// another.
//
// THE RULE, from the art bar of `specs/assets.md`: "The ten instruction glyphs are
// told apart in a `24`-unit tape cell." The Instruction glyphs row names one file
// per name in `INSTRUCTIONS` for that reason: a tape is a row of cells a player
// reads at a glance, and which instruction sits in a cell is read off its glyph.
//
// WHAT IT READS. Every one of the forty-five pairs differs on at least
// `DIFFER_MIN_SHARE` of the canvas the two share. One file shipped ten times
// differs by exactly nothing, since a PNG carries its pixels losslessly, so the
// floor is one hundredth — the smallest share worth calling measurable, six pixels
// of a `24`-unit cell. Two clear pixels count as the same pixel whatever bytes sit
// under them, because a straight-alpha canvas leaves those bytes undefined and a
// player sees nothing either way.
//
// WHAT IT DOES NOT DECIDE. Whether a pair is told apart IN A `24`-UNIT TAPE CELL is
// the art bar itself, and the reviewer's judgement. This point decides that a tape
// reads as ten instructions rather than one glyph repeated.
//
// THE EVIDENCE is the ten files side by side, magnified, so the pairs are compared
// by eye beside the verdict.

import { it } from "vitest";
import { assertGreaterThanOrEqual, assertLength, fail } from "../assert";
import { INSTRUCTIONS } from "../constants";
import { INSTRUCTION_SPRITES } from "./files";
import {
  DIFFER_MIN_SHARE,
  type Sprite,
  decodeProduced,
  differingShare,
  showSprites,
} from "./sprites";

it("draws a glyph of its own for each of the ten instructions", async () => {
  await showSprites("instructions", INSTRUCTION_SPRITES);

  assertLength(
    INSTRUCTION_SPRITES,
    INSTRUCTIONS.length,
    "one path per name in INSTRUCTIONS, so the pairs below are the ten glyphs'",
  );
  const readings = await decodeProduced(INSTRUCTION_SPRITES);
  const glyphs: Sprite[] = [];
  for (const [index, row] of INSTRUCTION_SPRITES.entries()) {
    const read = readings[index];
    if (read.sprite === null) fail(`a decoded ${row.label}`, read.reason);
    glyphs.push(read.sprite);
  }

  for (let i = 0; i < glyphs.length; i += 1) {
    for (let j = i + 1; j < glyphs.length; j += 1) {
      assertGreaterThanOrEqual(
        differingShare(glyphs[i], glyphs[j]),
        DIFFER_MIN_SHARE,
        `${INSTRUCTION_SPRITES[i].label} against ${INSTRUCTION_SPRITES[j].label}: the share of the canvas that differs`,
      );
    }
  }
});
