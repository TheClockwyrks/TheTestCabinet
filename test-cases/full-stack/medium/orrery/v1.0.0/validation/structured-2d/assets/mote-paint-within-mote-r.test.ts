// assets/mote-paint-within-mote-r — a mote's paint stays inside MOTE_R.
//
// THE RULE, from the art bar of `specs/assets.md`: "Every mote's paint stays
// inside `MOTE_R` (`22`) of its center, so motes on adjacent hexes never blur
// together." The Motes row fixes where that center is on the canvas — the sprite
// is "centered on every mote's position, at rest and while carried, upright at
// every moment of a cycle" — so the canvas's own center is the mote's position,
// and a `44 x 44` canvas reaches `MOTE_R` along its axes and past it into its
// corners. Two adjacent hexes are `HEX_PITCH` (`48`) apart, so two discs of `22`
// leave four units of sky between them; paint in the corners closes that gap.
//
// WHAT IT READS. The count of painted pixels — alpha above zero — outside the disc
// of `MOTE_R` about the canvas center, for each of the fifteen files. The rule is
// stated of EVERY mote's paint, so the count is zero rather than small; a build
// that keeps its drawing inside the radius the rule names clears it whatever it
// drew.
//
// THE EVIDENCE is the produced files magnified over a checkerboard, where paint
// reaching a corner of the canvas is paint outside the radius.

import { it } from "vitest";
import { assertEqual, assertLength, fail } from "../assert";
import { MOTES, MOTE_R } from "../constants";
import { MOTE_SPRITES } from "./files";
import { decodeProduced, paintOutside, showSprites } from "./sprites";

it("keeps every painted pixel of every mote sprite within 22 of its center", async () => {
  await showSprites("radius", MOTE_SPRITES);

  assertLength(
    MOTE_SPRITES,
    MOTES.length,
    "one path per name in MOTES, so the reading below is fifteen files rather than none",
  );
  const readings = await decodeProduced(MOTE_SPRITES);
  for (const [index, row] of MOTE_SPRITES.entries()) {
    const read = readings[index];
    if (read.sprite === null) fail(`a decoded ${row.label}`, read.reason);
    assertEqual(
      paintOutside(read.sprite, MOTE_R),
      0,
      `${row.label}: painted pixels further than MOTE_R (22) from the canvas center`,
    );
  }
});
