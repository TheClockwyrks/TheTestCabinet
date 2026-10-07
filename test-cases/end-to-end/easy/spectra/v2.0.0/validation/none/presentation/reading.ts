// presentation/reading — how this group reads what one frame painted.
//
// Only the `presentation` group reads a frame this way, so these live beside the
// checks that use them rather than in the shared harness next door. Like
// everything there they fix a READING alone — which places of a region a thing
// painted, and which draw of a frame a check is about — and never a threshold:
// every bound a check asserts is stated in that check, derived from the figure
// `specs/` fixes for it.
//
// WHAT IS READ IS PRESENCE, NEVER APPEARANCE. `specs/overview.md` fixes no
// palette — the colours, the type and the glow are the build's — so nothing here
// answers what a thing LOOKS like. The one question a reading answers is whether
// the build DREW something in a place the specification says something is drawn.
//
// AND WHY THE CONTROL IS THE SAME SQUARE OF THE SAME FIELD. `specs/field.md`
// puts a starfield behind the play field and leaves a build free to place a
// banner, a hint or a watermark anywhere it likes, so a reading held against a
// fixed colour would read a build's own stars as an entity. Every reading below
// is therefore taken TWICE at the same place — once with the thing on the field
// and once with it gone — and only the places that MOVED between the two are read
// as the thing. What is left cannot be the field, the starfield, or anything else
// the build drew there, because both readings carry it.
//
// EVERYTHING THAT CROSSES INTO THE PAGE STAYS IN THE HARNESS. What is here is
// arithmetic over readings the harness's `readRegion` already took, so a check
// reads a region once and asks these several questions of it.

import { fail } from "../assert";
import type { SpriteName } from "../constants";
import { colorDistance, type Blit, type Rgb } from "../harness";

/* -------------------------------------------------------------------------- */
/* What counts as painted                                                     */
/* -------------------------------------------------------------------------- */

/**
 * How far a place must move between the two readings to count as painted, as a
 * Euclidean RGB distance out of the `441` an RGB cube is across.
 *
 * THIS IS THE READING, NOT A THRESHOLD: it decides which places of a region
 * count as drawn on, and it is the whole of what a check here asserts. Two
 * readings of one place nothing was drawn on are identical, so anything above
 * zero would do to separate painted from unpainted; `12` is a little above the
 * rounding one composite can put on a pixel, so a faint glow a build lays around
 * a body counts as part of it and an untouched pixel never does.
 */
export const PAINT_MIN = 12;

/** Whether the place at `index` moved between the two readings. */
function movedAt(
  bare: readonly Rgb[],
  now: readonly Rgb[],
  index: number,
): boolean {
  return colorDistance(bare[index], now[index]) > PAINT_MIN;
}

/** Two readings of one place, taken on the same lattice. */
function sameLattice(a: readonly Rgb[], b: readonly Rgb[]): void {
  if (a.length !== b.length) {
    fail(
      `two readings of the same region (${a.length} samples)`,
      `${b.length} samples`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* What a thing painted                                                       */
/* -------------------------------------------------------------------------- */

/**
 * How many places of a region a thing painted: the places that moved between a
 * reading taken with the thing on the field and a reading of the same region
 * with the thing gone.
 *
 * The reading every check in this group takes. A thing that painted nothing
 * reports `0`, which is the failure those checks name.
 */
export function paintedCount(
  bare: readonly Rgb[],
  now: readonly Rgb[],
): number {
  sameLattice(bare, now);
  let count = 0;
  for (let i = 0; i < now.length; i += 1) {
    if (movedAt(bare, now, i)) count += 1;
  }
  return count;
}

/* -------------------------------------------------------------------------- */
/* Naming what was found                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The blit of a run that agrees best with one seeded sprite.
 *
 * Which draw a check is about, when a build is free to lay a glow, a shadow or a
 * halo of its own around a body and blit that too: the one that looks most like
 * the seeded art is the one the entity is claimed to be drawn from, and the
 * check states how closely it must agree.
 */
export function bestBlit(
  blits: readonly Blit[],
  sprite: SpriteName,
): Blit | undefined {
  let best: Blit | undefined;
  for (const blit of blits) {
    if (best === undefined || blit.agreement[sprite] > best.agreement[sprite]) {
      best = blit;
    }
  }
  return best;
}

/**
 * What a run of blits drew, as a failure message names it: each one's
 * destination box, the size of the source behind it, and how closely that source
 * agrees with each seeded sprite.
 */
export function describeBlits(blits: readonly Blit[]): string {
  if (blits.length === 0) return "no bitmap was blitted there";
  return blits
    .map((blit) => {
      const scores = (Object.entries(blit.agreement) as [SpriteName, number][])
        .map(([name, score]) => `${name} ${score.toFixed(3)}`)
        .join(", ");
      const source = blit.captured
        ? `${blit.source.width}x${blit.source.height} source`
        : "a source the recorder did not capture";
      return (
        `a ${blit.width.toFixed(1)}x${blit.height.toFixed(1)} box from a ` +
        `${source} (${scores})`
      );
    })
    .join("; ");
}
