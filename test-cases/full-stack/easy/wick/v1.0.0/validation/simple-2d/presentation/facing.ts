// presentation — the picture a lamplighter blit actually put on the stage, and
// the produced sprite that picture is held against.
//
// specs/assets.md ("Animation") fixes the produced picture and the relation the
// two drawn pictures stand in: "The produced idle sprite faces right, and the
// lamplighter drawn facing left is that sprite reflected across its vertical
// axis." How a build reaches the reflected picture is its own: it may mirror the
// one file in code or ship a second file already reflected, and nothing in the
// specification prefers either. So a check that read the mirror off the
// transform alone would fail the build that shipped two files, and one that
// compared two frames against each other would decide the two facings together
// rather than one at a time. What every design shares is the PICTURE that
// reached the canvas, and that is what this module reads: the pixels of the file
// the blit painted, reflected when the transform in force reflected them, held
// against the pixels of the produced idle sprite as it was authored.

import { assertDefined, fail } from "../assert";
import { LAMPLIGHTER_IDLE_PATH } from "../constants";
import {
  mirrorRect,
  pixelsDiffering,
  imagePixels,
  producedFile,
  type Blit,
  type PixelRect,
} from "../harness";

/** The pixels a blit put on the stage, as an upright picture. */
export async function drawnPicture(
  blit: Blit,
  what: string,
): Promise<PixelRect> {
  const file = producedFile(blit.id.replace(/^assets\//, ""));
  assertDefined(file, `the produced file ${blit.id}, drawn as the ${what}`);
  const pixels = await imagePixels(file as string);
  assertDefined(pixels, `the pixels of ${blit.id}, drawn as the ${what}`);
  const rect = pixels as PixelRect;
  return blit.mirrored ? mirrorRect(rect) : rect;
}

/**
 * The produced idle sprite as it was authored: the right-facing picture every
 * lamplighter a frame draws is that picture or its reflection.
 */
export async function producedIdle(): Promise<PixelRect> {
  const file = producedFile(LAMPLIGHTER_IDLE_PATH);
  assertDefined(file, `the produced file assets/${LAMPLIGHTER_IDLE_PATH}`);
  const pixels = await imagePixels(file as string);
  assertDefined(pixels, `the pixels of assets/${LAMPLIGHTER_IDLE_PATH}`);
  return pixels as PixelRect;
}

/**
 * Assert `a` is `b` itself, pixel for pixel.
 *
 * No tolerance: both readings are decodings of the same produced file, so a
 * build that draws it as it was authored matches byte for byte.
 */
export function assertSamePicture(
  a: PixelRect,
  b: PixelRect,
  context: string,
): void {
  const differing = pixelsDiffering(a, b);
  if (differing !== 0) {
    fail(
      `the produced picture itself, matching pixel for pixel (${context})`,
      `${differing} of ${a.width * a.height} pixels differ`,
    );
  }
}

/**
 * Assert `a` is `b` reflected across its vertical axis, pixel for pixel.
 *
 * No tolerance: a reflection of a decoded bitmap is a reordering of its own
 * bytes, so a build that draws one picture reflected against the other matches
 * exactly, whichever design it took to reach it.
 */
export function assertMirrored(
  a: PixelRect,
  b: PixelRect,
  context: string,
): void {
  const differing = pixelsDiffering(a, mirrorRect(b));
  if (differing !== 0) {
    fail(
      `a picture reflected across its vertical axis, matching pixel for pixel (${context})`,
      `${differing} of ${a.width * a.height} pixels differ`,
    );
  }
}
