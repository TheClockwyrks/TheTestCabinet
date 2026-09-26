// assets/evolved-effects-differ-from-base — an evolved weapon's effect is a new
// drawing rather than its base's file under a new name.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The weapon effects"): "Each
// of the six evolved weapons has an effect of the same form, frame count, and
// canvas as its base's, at the path below, visibly distinct from its base's so a
// player sees at a glance that the tool has transformed." A file shipped twice is
// distinct from itself in nothing at all, so the review item words the floor this
// point reads: each of the six evolved effects is not pixel-identical to its
// base's.
//
// THE SIX PAIRS. `specs/evolutions.md` fixes which base each evolution comes
// from, and the effect rows follow it: Pyre against Taper, Beacon against Ember,
// Hail against Pin, Chandelier against Lantern, Corona against Halo, and Blaze
// against Oil Splash. Each pair shares a canvas, so the comparison is pixel for
// pixel across the whole of it.
//
// THE TOLERANCE. None, and none is needed: a PNG carries its pixels losslessly,
// so two files holding one picture differ on exactly nothing. How far apart the
// two must LOOK — "visibly distinct ... at a glance" — is the art bar and the
// presentation domain's aesthetic rating, which is a person's to make.
//
// WHAT IT DELIBERATELY DOES NOT READ. That each file exists on its canvas and
// carries paint is `assets/evolved-effect-sprites-produced` and
// `assets/base-effect-sprites-produced`.
//
// THE DRIVE. None. This point is about FILES, so it reads the repository the
// build produced and drives no game.

import { it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { EVOLUTIONS, EVOLUTION_IDS } from "../constants";
import { writeImage } from "./media-out";
import {
  decodeAll,
  differingPixels,
  effectSprites,
  paintSprites,
  type SpriteEntry,
} from "./sprites";

/**
 * The six pairs, each evolution's single effect sprite beside its base's:
 * `EVOLUTIONS` names the base each evolution comes from, and both are stills of
 * one file, so each pair is two entries.
 */
const PAIRS: readonly { evolved: SpriteEntry; base: SpriteEntry }[] =
  EVOLUTION_IDS.map((id) => ({
    evolved: effectSprites(id)[0]!,
    base: effectSprites(EVOLUTIONS[id].from)[0]!,
  }));

it("draws each evolved effect differently from its base's", async () => {
  // Painted before anything is read, so a file that will not decode still leaves
  // the picture that shows what the build shipped.
  writeImage(
    "pairs",
    await paintSprites(
      "The six pairs side by side",
      PAIRS.flatMap((pair) => [pair.evolved, pair.base]),
      { checker: true, columns: 4, cell: 128 },
    ),
  );

  for (const pair of PAIRS) {
    const [evolved, base] = await decodeAll([pair.evolved, pair.base]);
    assertGreaterThanOrEqual(
      differingPixels(evolved!, base!),
      1,
      `pixels differing between ${pair.evolved.file} and ${pair.base.file}`,
    );
  }
});
