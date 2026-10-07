// presentation/reading — how this group reads one drawn frame.
//
// Only the `presentation` group reads a frame this way, so these live beside the
// checks that use them rather than in the shared harness next door. Like
// everything there, they fix a READING and an ARRANGEMENT alone — which draw is
// attributed to which body — and never a threshold: every bound a check asserts
// is stated in that check, derived from the figure specs/ fixes for it.
//
// NO COLOUR IS READ HERE. specs/overview.md fixes no palette and no typeface, so
// nothing in this group asks what colour a body is drawn in. A point either
// reads the image source handed to a draw, or reads one place of the board twice
// — with the thing there and with it removed through the debug API — and asks
// only whether the picture changed. What the change looks like is the reviewer's,
// from the captured still.

import { identifySprite, type DrawnImage, type SpriteMatch } from "../harness";

/* -------------------------------------------------------------------------- */
/* Attributing a draw to the body it was drawn for                            */
/* -------------------------------------------------------------------------- */

/**
 * Every image the frame drew whose destination box is centred within `radius` of
 * `(x, y)`.
 *
 * How a draw is named by the body it belongs to: the checks below pose every body
 * on a tile centre or read its reported centre back, so the draw and the body
 * coincide and the caller's radius is the whole of the slack.
 */
export function drawnAt(
  images: readonly DrawnImage[],
  x: number,
  y: number,
  radius: number,
): DrawnImage[] {
  return images.filter(
    (image) => Math.hypot(image.x - x, image.y - y) <= radius,
  );
}

/**
 * A seeded-frame identifier that rasterizes each distinct source once.
 *
 * A build hands the context the same `ImageBitmap` on every frame it draws that
 * frame on, so a check that reads a second of animation asks about the same
 * handful of objects a hundred times over. The identification itself is the
 * shared harness's — the source's own pixels held against the seeded PNGs — and
 * this only remembers what it answered.
 */
export function spriteReader(): (
  source: unknown,
) => Promise<SpriteMatch | null> {
  const seen = new Map<unknown, SpriteMatch | null>();
  return async (source: unknown): Promise<SpriteMatch | null> => {
    if (seen.has(source)) return seen.get(source) ?? null;
    const match = await identifySprite(source);
    seen.set(source, match);
    return match;
  };
}

/** Every seeded frame the draws near `(x, y)` were made from, in draw order. */
export async function framesDrawnAt(
  read: (source: unknown) => Promise<SpriteMatch | null>,
  images: readonly DrawnImage[],
  x: number,
  y: number,
  radius: number,
): Promise<SpriteMatch[]> {
  const near = drawnAt(images, x, y, radius);
  const matches = await Promise.all(near.map((image) => read(image.source)));
  return matches.filter((match): match is SpriteMatch => match !== null);
}

/** A seeded frame as a failure message names it: `assets/worm/2.png`. */
export function frameName(match: SpriteMatch): string {
  return `assets/${match.folder}/${match.index}.png`;
}
