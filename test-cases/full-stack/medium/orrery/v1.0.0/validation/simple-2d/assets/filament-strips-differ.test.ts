// assets/filament-strips-differ — the two filament strips differ from one another.
//
// THE RULE, from the art bar of `specs/assets.md`: "The triune strip reads as
// clearly heavier than the plain one at a glance." The Filaments row names the two
// files for that reason — `FILAMENT_SPRITE_PATHS` holds one strip per weight, the
// plain for a join of weight `1` and the triune for one of weight `3` — and a
// player reads a triune join off the field by its strip.
//
// WHAT IT READS. The two files differ on at least `DIFFER_MIN_SHARE` of the canvas
// they share. One file shipped twice differs by exactly nothing, since a PNG
// carries its pixels losslessly, so the floor is one hundredth — the smallest
// share worth calling measurable. Two clear pixels count as the same pixel
// whatever bytes sit under them, because a straight-alpha canvas leaves those
// bytes undefined and a player sees nothing either way.
//
// WHAT IT DOES NOT DECIDE. Whether the triune strip reads as CLEARLY HEAVIER at a
// glance is the art bar itself, and the reviewer's judgement. This point decides
// that two strips were drawn rather than one shipped under both names.
//
// THE EVIDENCE is the two strips side by side, magnified, so the weights are
// compared by eye beside the verdict.

import { it } from "vitest";
import { assertGreaterThanOrEqual, assertLength, fail } from "../assert";
import { FILAMENT_SPRITES } from "./files";
import {
  DIFFER_MIN_SHARE,
  decodeProduced,
  differingShare,
  showSprites,
} from "./sprites";

it("draws the triune strip as a different picture from the plain one", async () => {
  await showSprites("weights", FILAMENT_SPRITES);

  assertLength(
    FILAMENT_SPRITES,
    2,
    "the plain strip and the triune strip, so the comparison below is of two files",
  );
  const readings = await decodeProduced(FILAMENT_SPRITES);
  const [plain, triune] = FILAMENT_SPRITES;
  const readPlain = readings[0];
  const readTriune = readings[1];
  if (readPlain.sprite === null)
    fail(`a decoded ${plain.label}`, readPlain.reason);
  if (readTriune.sprite === null) {
    fail(`a decoded ${triune.label}`, readTriune.reason);
  }

  assertGreaterThanOrEqual(
    differingShare(readPlain.sprite, readTriune.sprite),
    DIFFER_MIN_SHARE,
    "the share of the canvas on which the triune strip differs from the plain one",
  );
});
