// assets/gem-sprites-produced — the three gem tiers are on disk, each on the
// canvas its size fixes.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The sprites") gives the row
// "Gems | `assets/sprites/gems/small.png`, `medium.png`, `large.png` | `draw` |
// `1` each | `8 x 8`, `12 x 12`, `16 x 16`", under "Every sprite is pixel art
// drawn at one unit per pixel on a transparent, straight-alpha canvas of exactly
// the size its row states, so a sprite `24` pixels wide stands `24` units wide in
// the world". The three canvases are exact and differ tier by tier, which is
// also how the specification says a player tells them apart: "The three gem
// tiers are told apart by size and form."
//
// THE TOLERANCES. The three paths and the three canvases are exact figures and
// are read exactly. That each file carries a drawing rather than an empty canvas
// is read against `PAINT_MIN_SHARE`, whose reasoning `assets/sprites.ts` states.
//
// WHAT IT DELIBERATELY DOES NOT READ. What a gem is worth is the progression
// category's; that a dropped gem is drawn at its tier's size is the presentation
// category's; "told apart by size and form" beyond the canvas is the art bar.
//
// THE DRIVE. None. This point is about FILES, so it reads the repository the
// build produced and drives no game.

import { it } from "vitest";
import { writeImage } from "./media-out";
import {
  assertProducedAt,
  decodeSprites,
  GEM_SPRITES,
  paintSprites,
} from "./sprites";

it("ships the small, medium and large gems at 8, 12 and 16 pixels", async () => {
  const read = await decodeSprites(GEM_SPRITES);
  writeImage(
    "gems",
    await paintSprites("The three gem sprites", GEM_SPRITES, {
      checker: true,
      columns: 3,
      cell: 128,
    }),
  );

  for (const [index, gem] of GEM_SPRITES.entries()) {
    assertProducedAt(gem, read[index]!);
  }
});
