// presentation/reading — how this group reads what one frame painted.
//
// Only the `presentation` group reads a frame this way, so these live beside the
// checks that use them rather than in the shared harness next door. Like
// everything there they fix a READING alone — which pixels a colour is taken
// from, and how two patches of stage are held against each other — and never a
// threshold: every distance, share and bound a check asserts is stated in that
// check, derived from the figure `specs/` fixes for it.
//
// WHY A THING'S COLOUR IS THE COLOUR OF WHAT IT PAINTED, AND WHY THE CONTROL IS
// THE SAME SQUARE OF THE SAME FIELD. `specs/overview.md` fixes no palette — the
// colours, the type and the glow are the build's — and `specs/field.md` puts a
// starfield behind the play field and leaves a build free to place a banner, a
// hint or a watermark anywhere it likes. So a reading held against a fixed
// colour, or against some other patch of the stage, would read a build's own
// stars as an entity. Every reading below is therefore taken TWICE at the same
// place — once with the thing on the field and once with it gone — and only the
// places that MOVED between the two are read as the thing. What is left cannot
// be the field, the starfield, or anything else the build drew there, because
// both readings carry it.
//
// AND WHY IT IS NOT THE HARNESS'S OWN `sampleColor`. That reading is five points
// of a small cluster averaged, which is the right reading for a check asking
// whether a place CHANGED. It is the wrong reading for a check asking what
// colour a body IS: `specs/assets.md` seeds sparse pixel art with straight
// alpha, so a cluster centred on a drone commonly lands half on the field
// showing through it, and how much it does is a fact about the silhouette rather
// than about the colour.
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
 * THIS IS THE READING, NOT A TOLERANCE: it decides which pixels a colour is
 * taken from, and every bound a check asserts against what comes out of it is
 * stated in that check. Two readings of one place nothing was drawn on are
 * identical, so anything above zero would do to separate painted from unpainted;
 * `12` is a little above the rounding one composite can put on a pixel and far
 * below the `40` this checklist calls the least a player reads at a glance, so a
 * faint glow a build lays around a body counts as part of it and an untouched
 * pixel never does.
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
/* The colour a thing renders in                                              */
/* -------------------------------------------------------------------------- */

/** What a thing painted inside one region: its colour, and how much of it. */
export interface Painted {
  /** The mean of the places the thing painted. */
  color: Rgb;
  /** How many places it painted. */
  count: number;
  /** How many places the region holds at all. */
  total: number;
}

/**
 * The colour a thing renders in: the mean of the places it painted inside a
 * region, held against a reading of that same region with the thing gone.
 *
 * The reading a check comparing two things of DIFFERENT shapes or sizes takes,
 * since two regions of different extents cannot be held against each other place
 * for place. A thing that painted nothing reports a count of `0`, and the check
 * that asked says so as the precondition it is rather than comparing black.
 */
export function paintedColor(
  bare: readonly Rgb[],
  now: readonly Rgb[],
): Painted {
  sameLattice(bare, now);
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let i = 0; i < now.length; i += 1) {
    if (!movedAt(bare, now, i)) continue;
    r += now[i].r;
    g += now[i].g;
    b += now[i].b;
    count += 1;
  }
  if (count === 0) {
    return { color: { r: 0, g: 0, b: 0 }, count: 0, total: now.length };
  }
  return {
    color: { r: r / count, g: g / count, b: b / count },
    count,
    total: now.length,
  };
}

/* -------------------------------------------------------------------------- */
/* How far apart two pictures read                                            */
/* -------------------------------------------------------------------------- */

/** How far apart two pictures read, and over how much of them. */
export interface Apart {
  /** The mean RGB distance over the places either picture painted. */
  distance: number;
  /** How many places that was. */
  samples: number;
}

/**
 * How far apart two pictures read: the mean distance, place for place, over
 * every place EITHER of them painted.
 *
 * The reading a check comparing two things drawn at the same footprint takes —
 * one drone against another, one band of a thing against its other band, a
 * shimmering Flux against a settled one. Held place for place rather than as two
 * mean colours, so two pictures that carry the same colours in different places
 * read apart rather than reading the same; and restricted to what was painted,
 * so the answer does not fall as the box around the pair grows.
 *
 * The two regions must have been read on the same lattice — the same extent at
 * the same step — which is what makes place `i` of one comparable with place `i`
 * of the other.
 */
export function apartness(
  bareA: readonly Rgb[],
  a: readonly Rgb[],
  bareB: readonly Rgb[],
  b: readonly Rgb[],
): Apart {
  sameLattice(bareA, a);
  sameLattice(bareB, b);
  sameLattice(a, b);
  let sum = 0;
  let samples = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (!movedAt(bareA, a, i) && !movedAt(bareB, b, i)) continue;
    sum += colorDistance(a[i], b[i]);
    samples += 1;
  }
  return { distance: samples === 0 ? 0 : sum / samples, samples };
}

/**
 * How far a thing reads from the field behind it: {@link apartness} between a
 * reading and its own control.
 *
 * The same arithmetic with the second picture the bare field, so "the drone
 * against the empty field behind it" and "the cyan drone against the magenta
 * one" are one reading asked twice rather than two readings that could disagree.
 */
export function apartFromField(
  bare: readonly Rgb[],
  now: readonly Rgb[],
): Apart {
  return apartness(bare, now, bare, bare);
}

/** How many places a thing painted inside a region. */
export function paintedCount(
  bare: readonly Rgb[],
  now: readonly Rgb[],
): number {
  return paintedColor(bare, now).count;
}

/* -------------------------------------------------------------------------- */
/* Naming what was found                                                      */
/* -------------------------------------------------------------------------- */

/** A sampled colour, written the way a failure message reads it. */
export function rgb(color: Rgb): string {
  return `rgb(${color.r.toFixed(0)}, ${color.g.toFixed(0)}, ${color.b.toFixed(0)})`;
}

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
