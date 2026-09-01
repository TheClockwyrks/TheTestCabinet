// assets/base-effect-sprites-produced — every base weapon's effect is on disk,
// at the frame count and canvas its row states.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The weapon effects") gives
// one row per weapon, and every figure this reads is in it: taper's slash as one
// sprite on `120 x 40`, ember's bolt on `16 x 16`, pin's dart on `12 x 12`,
// lantern's on `28 x 28`, halo's ring on `160 x 160`, oil splash's puddle on
// `100 x 100`, shard's on `16 x 16`, spark's strike as "a sheet of `4`, played
// once" on `80 x 80`, sconce's as "a sheet of `4`, spinning" on `24 x 24`, and
// flare's burst as "a sheet of `6`, played once" on `128 x 128`. A sheet lands as
// separate files — "A sheet's frames are separate PNG files, numbered from `0`,
// each on a canvas of the sheet's size" — and every sprite stands on "a
// transparent, straight-alpha canvas of exactly the size its row states".
//
// THE TOLERANCES. Every path and every canvas is an exact figure and is read
// exactly. That each file carries a drawing rather than an empty canvas is read
// against `PAINT_MIN_SHARE`, whose reasoning `assets/sprites.ts` states.
//
// WHAT IT DELIBERATELY DOES NOT READ. The six evolved effects are
// `assets/evolved-effect-sprites-produced`; that each effect is drawn over its
// weapon's live shape, and that a sheet plays through at the rate its row fixes,
// is the presentation category's.
//
// THE DRIVE. None. This point is about FILES, so it reads the repository the
// build produced and drives no game.

import { it } from "vitest";
import { writeImage } from "./media-out";
import {
  assertProducedAt,
  BASE_EFFECT_SPRITES,
  decodeSprites,
  paintSprites,
} from "./sprites";

it("ships all twenty-one base effect files at their stated canvases", async () => {
  const read = await decodeSprites(BASE_EFFECT_SPRITES);
  writeImage(
    "effects",
    await paintSprites("The ten base effects", BASE_EFFECT_SPRITES, {
      checker: true,
      columns: 6,
      cell: 112,
    }),
  );

  for (const [index, effect] of BASE_EFFECT_SPRITES.entries()) {
    assertProducedAt(effect, read[index]!);
  }
});
