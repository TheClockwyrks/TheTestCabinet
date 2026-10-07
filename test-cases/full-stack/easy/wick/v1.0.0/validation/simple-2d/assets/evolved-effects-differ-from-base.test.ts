// Wick — assets/evolved-effects-differ-from-base: an evolved weapon's effect is
// its own picture rather than its base's file under a new name.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/assets.md (The weapon effects): each evolved effect is "visibly
//     distinct from its base's so a player sees at a glance that the tool has
//     transformed", on the same form, frame count, and canvas.
//   - specs/evolutions.md fixes which base each evolution comes from, and
//     `constants.ts` carries those six pairings as `EVOLUTIONS`.
//   - The review item states the floor read here: "pyre.png differs from
//     taper.png, beacon.png from ember.png, hail.png from pin.png,
//     chandelier.png from lantern.png, corona.png from halo.png, and blaze.png
//     from oil-splash.png, none pixel-identical to its base."
//
// WHAT IS READ. The six pairs, compared pixel for pixel. A file shipped twice
// differs by exactly nothing, since a PNG carries its pixels losslessly, so
// what this separates is a transformed effect from a copy. How far a picture
// must move to be "visibly distinct" is the art bar the presentation domain's
// rating judges.
//
// HOW TWO FILES ARE COMPARED. Two fully transparent pixels count as the same
// pixel whatever colour bytes sit under them: a straight-alpha canvas leaves
// those undefined and a player sees nothing either way.
//
// WHAT IT DELIBERATELY DOES NOT READ. That either file exists on its canvas and
// carries paint is the two `*-effect-sprites-produced` points'.
//
// WHY NO NIGHT IS POSED. This point is about FILES, so nothing is posed and no
// game is driven. The evidence is the six pairs side by side, evolution beside
// base.
//
// TOLERANCE. None. Pixel identity is exact.

import { it } from "vitest";
import { fail } from "../assert";
import { EVOLUTIONS, EVOLUTION_IDS } from "../constants";
import { captureCanvas } from "../harness";
import {
  committed,
  effectSprites,
  readSprites,
  requireAll,
  samePicture,
  sheetOf,
  type ProducedSprite,
} from "./produced";

/** The twelve files, evolution beside base, in `EVOLUTION_IDS` order. */
const PAIRS: readonly ProducedSprite[] = EVOLUTION_IDS.flatMap((evolution) => [
  effectSprites(evolution)[0],
  effectSprites(EVOLUTIONS[evolution].from)[0],
]);

it("draws each evolved effect differently from the base it came from", async () => {
  const pixels = requireAll(await readSprites(PAIRS));

  captureCanvas(
    await sheetOf(PAIRS, {
      title: "assets/sprites/effects — each evolution beside its base",
    }),
    "pairs",
  );

  for (let pair = 0; pair < EVOLUTION_IDS.length; pair += 1) {
    const evolved = PAIRS[pair * 2];
    const base = PAIRS[pair * 2 + 1];
    if (samePicture(pixels[pair * 2], pixels[pair * 2 + 1])) {
      fail(
        `${committed(evolved)} drawn differently from ${committed(base)}`,
        "the two files are pixel-identical",
      );
    }
  }
});
