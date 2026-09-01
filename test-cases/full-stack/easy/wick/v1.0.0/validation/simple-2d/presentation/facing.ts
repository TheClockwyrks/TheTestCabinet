// presentation — the picture a lamplighter blit actually put on the stage, so
// the two facing points can compare one frame against the other.
//
// specs/assets.md leaves the build one choice here and fixes the rest: "The
// sprite faces the way `facing` says: produce one facing and mirror it in code,
// or produce both." Which way the produced file itself faces is therefore the
// build's, and a check that read the mirror off the transform alone would fail
// a build that shipped two files, while one that compared the two files alone
// would fail a build that mirrors in code. What both designs share is the
// PICTURE that reached the canvas, and that is what this module reads: the
// pixels of the file the blit painted, reflected when the transform in force
// reflected them.

import { assertDefined, fail } from "../assert";
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
 * Assert `a` is `b` reflected across its vertical axis, pixel for pixel.
 *
 * No tolerance: a reflection of a decoded bitmap is a reordering of its own
 * bytes, so a build that draws one picture mirrored against the other matches
 * exactly, whichever of the two designs specs/assets.md allows it took.
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
