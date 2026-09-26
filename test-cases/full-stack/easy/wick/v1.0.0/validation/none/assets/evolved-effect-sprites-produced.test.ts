// assets/evolved-effect-sprites-produced — every evolved weapon's effect is on
// disk, on its base's canvas.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The weapon effects"): "Each
// of the six evolved weapons has an effect of the same form, frame count, and
// canvas as its base's, at the path below", and the table lands them at
// `assets/sprites/effects/pyre.png`, `beacon.png`, `hail.png`, `chandelier.png`,
// `corona.png` and `blaze.png`. So each canvas is its base's row: Pyre on Taper's
// `120 x 40`, Beacon on Ember's `16 x 16`, Hail on Pin's `12 x 12`, Chandelier on
// Lantern's `28 x 28`, Corona on Halo's `160 x 160`, and Blaze on Oil Splash's
// `100 x 100`, each one sprite as its base is one sprite. Every sprite stands on
// "a transparent, straight-alpha canvas of exactly the size its row states".
//
// THE TOLERANCES. Every path and every canvas is an exact figure and is read
// exactly. That each file carries a drawing rather than an empty canvas is read
// as presence: at least one pixel of the canvas is not clear.
//
// WHAT IT DELIBERATELY DOES NOT READ. That each is "visibly distinct from its
// base's" is `assets/evolved-effects-differ-from-base`; that a live evolved shape
// is drawn from its own file is the presentation category's.
//
// THE DRIVE. None. This point is about FILES, so it reads the repository the
// build produced and drives no game.

import { it } from "vitest";
import { writeImage } from "./media-out";
import {
  assertProducedAt,
  decodeSprites,
  EVOLVED_EFFECT_SPRITES,
  paintSprites,
} from "./sprites";

it("ships the six evolved effect files at their bases' canvases", async () => {
  const read = await decodeSprites(EVOLVED_EFFECT_SPRITES);
  writeImage(
    "evolved",
    await paintSprites("The six evolved effects", EVOLVED_EFFECT_SPRITES, {
      checker: true,
      columns: 3,
      cell: 144,
    }),
  );

  for (const [index, effect] of EVOLVED_EFFECT_SPRITES.entries()) {
    assertProducedAt(effect, read[index]!);
  }
});
