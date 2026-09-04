// assets/sprites-on-transparent-ground — the sprites are authored on
// transparency.
//
// specs/assets.md: "Produce each of these on a transparent, straight-alpha
// canvas", and the art bar closes with "none of them relies on a background
// behind it". Every sprite's object is smaller than its stated canvas — the
// planet's disc is 140 pixels on a 160 canvas, the pods and ball are drawn on
// their 10- and 8-unit bodies inside 24 — so on a transparent ground some of
// each canvas is bare, and that is what is read off the committed pixels: the
// file decodes with an alpha channel, and a measurable share of its canvas is
// clear ground rather than paint.
//
// THE GROUND LINE IS A TOLERANCE. Clear ground is read at alpha <= 32 of 255
// rather than exactly 0, so an atmosphere, glow, or soft brush edge counts as
// the faint paint it is; and one percent of the canvas is the floor, because
// the geometry above leaves far more than that bare while an opaque plate — a
// sprite that relies on a background — leaves none at all. Straight alpha is
// the PNG format's own storage, so decoding as a PNG with transparency IS the
// straight-alpha canvas; a premultiplied export has no distinct signature to
// read here.

import { it } from "vitest";
import { assertGreaterThanOrEqual, fail } from "../assert";
import { writeImage } from "./media-out";
import {
  paintCheckerboard,
  readSprite,
  SPRITES,
  type SpriteRead,
} from "./sprite-ground";

/** Alpha at or under this of 255 reads as clear ground. */
const GROUND_ALPHA_NOTE = 32;
/** At least this share of each canvas must be clear ground. */
const MIN_GROUND_SHARE = 0.01;

it("authors every produced sprite on a transparent ground", async () => {
  try {
    writeImage("checkerboard", await paintCheckerboard());
  } catch {
    // A sprite that cannot be decoded fails below, by name; the evidence
    // picture is the only thing given up.
  }
  for (const sprite of SPRITES) {
    let read: SpriteRead;
    try {
      read = await readSprite(sprite.path);
    } catch (error) {
      fail(
        `${sprite.path} committed and decoding on a transparent, straight-alpha canvas (specs/assets.md, the sprites)`,
        `it did not decode: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    assertGreaterThanOrEqual(
      read.groundShare,
      MIN_GROUND_SHARE,
      `${sprite.path}: share of the canvas that is clear ground ` +
        `(alpha <= ${GROUND_ALPHA_NOTE}) — an opaque plate relies on a background`,
    );
  }
});
