// Wick — assets/evolved-effect-sprites-produced: the six evolved weapons'
// effects are committed at the paths and canvases their rows fix, each painted.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/assets.md (The weapon effects): "Each of the six evolved weapons
//     has an effect of the same form, frame count, and canvas as its base's, at
//     the path below", with the table giving `pyre.png`, `beacon.png`,
//     `hail.png`, `chandelier.png`, `corona.png`, and `blaze.png`, all under
//     `assets/sprites/effects/`.
//   - The bases those canvases come from are the same table's rows: Taper's
//     `120 x 40`, Ember's `16 x 16`, Pin's `12 x 12`, Lantern's `28 x 28`,
//     Halo's `160 x 160`, and Oil Splash's `100 x 100`. All six bases hold one
//     shape, so all six evolutions are one sprite each.
//   - `constants.ts` carries each path and canvas as `EFFECT_SPRITES`, and
//     `EVOLUTION_IDS` names the six.
//
// WHAT IS READ. The six files, each decoding, each on the exact canvas its
// base's row states, each carrying at least one pixel that is not fully
// transparent.
//
// WHAT IT DELIBERATELY DOES NOT READ. That each differs from its base's is
// `assets/evolved-effects-differ-from-base`; when an evolved weapon's effect is
// drawn at all is the evolutions category's.
//
// WHY NO NIGHT IS POSED. This point is about FILES, so nothing is posed and no
// game is driven. The evidence is the six files side by side.
//
// TOLERANCE. None. Six exact paths, six exact canvases, and a count.

import { it } from "vitest";
import { captureCanvas } from "../harness";
import {
  EVOLVED_EFFECT_SPRITES,
  assertProduced,
  readSprites,
  sheetOf,
} from "./produced";

it("commits the six evolved effects on their bases' canvases", async () => {
  const reads = await readSprites(EVOLVED_EFFECT_SPRITES);

  captureCanvas(
    await sheetOf(EVOLVED_EFFECT_SPRITES, {
      title: "assets/sprites/effects — the six evolutions",
    }),
    "evolved",
  );

  for (const read of reads) assertProduced(read);
});
