// Wick — assets/sprites-on-transparent-ground: the sprites are authored on
// transparency, so each one sits over the night rather than carrying a plate of
// its own.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/assets.md (The sprites): "Every sprite is pixel art drawn at one
//     unit per pixel on a transparent, straight-alpha canvas of exactly the size
//     its row states ... Each is drawn centered on the thing it depicts."
//   - specs/world.md and specs/ui.md leave the field's palette to the build, so
//     what a check may read of a sprite's ground is that it IS ground: a
//     picture drawn on a canvas larger than itself leaves some of that canvas
//     bare, and a plate does not.
//   - The review item states the reading: every produced sprite and sheet frame
//     "carries at least one fully transparent pixel ... so none relies on a
//     background behind it".
//
// WHAT IS READ. Every produced sprite and sheet frame this specification names
// — the lamplighter's idle and walk, all thirteen enemy sheets, the puff, the
// gems, the pickups, all sixteen effects, and all twenty-seven icons — decodes,
// and carries at least one pixel whose alpha is exactly `0`.
//
// WHY THE GROUND TILE IS NOT AMONG THEM. The item's own clause is "so none
// relies on a background behind it", and the ground tile is the background:
// specs/assets.md has it "repeated across the world" and specs/world.md draws
// the ground from it, so bare canvas in that file is a hole in the world rather
// than authored transparency. Every other produced file is drawn OVER that
// ground, and it is those the reading covers.
//
// WHY ALPHA EXACTLY ZERO. `specs/assets.md` says transparent, and a PNG stores
// straight alpha, so a pixel the artist never touched decodes at exactly `0`. A
// soft edge or a glow is the faint paint it is and is not counted; a sprite
// wants only one untouched pixel to show it was drawn on a canvas rather than
// over a plate, and every row's canvas is larger than the thing it depicts.
//
// WHY STRAIGHT ALPHA IS NOT SEPARATELY READ. Straight alpha is the PNG format's
// own storage, so a file that decodes as a PNG with an alpha channel IS on a
// straight-alpha canvas; a premultiplied export leaves no signature a reader
// could tell from a darker sprite.
//
// WHY NO NIGHT IS POSED. This point is about FILES, so nothing is posed and no
// game is driven. The evidence is every sprite composited over a checkerboard,
// where the checker showing through is the transparency itself.
//
// TOLERANCE. None. The alpha floor is exactly `0` and the reading is a count.

import { it } from "vitest";
import { assertGreaterThanOrEqual, fail } from "../assert";
import { captureCanvas } from "../harness";
import {
  ALL_SPRITES,
  GROUND_SPRITE,
  clearPixels,
  committed,
  readSprites,
  sheetOf,
} from "./produced";

/** Every produced sprite drawn OVER the ground, which is all but the ground. */
const OVER_THE_GROUND = ALL_SPRITES.filter(
  (sprite) => sprite.path !== GROUND_SPRITE.path,
);

it("authors every sprite drawn over the night on a transparent canvas", async () => {
  const reads = await readSprites(OVER_THE_GROUND);

  captureCanvas(
    await sheetOf(OVER_THE_GROUND, {
      title: "every produced sprite over a checkerboard",
      checkerboard: true,
    }),
    "checkerboard",
  );

  for (const { sprite, pixels, reason } of reads) {
    if (pixels === null) fail(`a decodable image at ${committed(sprite)}`, reason);
    assertGreaterThanOrEqual(
      clearPixels(pixels),
      1,
      `${committed(sprite)}: fully transparent pixels on its canvas — a sprite ` +
        "authored on transparency leaves the canvas it did not draw on bare",
    );
  }
});
