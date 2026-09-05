// presentation/reading — how this group reads what one frame painted.
// LOCAL TO THIS GROUP.
//
// The harness next door reads pixels the way almost every check wants them read:
// a cluster at a point (`sampleColor`), the lit core of a body (`litBox`), a box
// held for comparison (`regionPixels`). This group wants something narrower —
// one square of the stage read TWICE, once with the thing on it and once with
// the thing gone, and only the places that MOVED between the two read as the
// thing. No other group holds a footprint against its
// own control that way, so it lives beside the checks that do rather than in the
// file every group is editing. Like everything there it fixes a READING alone —
// which places of a region a thing painted, and what shape a build blitted — and
// never a threshold: every share, agreement and bound a check asserts is stated
// in that check, derived from the figure `specs/` fixes for it.
//
// WHAT IS READ OF A REGION IS PRESENCE, NEVER APPEARANCE. `specs/overview.md`
// fixes no palette — the colours, the type and the glow are the build's — so
// nothing here answers what a thing LOOKS like. The one question a region reading
// answers is whether the build DREW something in a place the specification says
// something is drawn.
//
// AND WHY THE CONTROL IS THE SAME SQUARE OF THE SAME FIELD. `specs/field.md` puts
// a starfield behind the play field and leaves a build free to place a banner, a
// hint or a watermark anywhere it likes, so a reading held against a fixed colour
// would read a build's own stars as an entity. Every region reading below is
// therefore taken twice at the same place and only the places that moved are read
// as the thing. What is left cannot be the field, the starfield, or anything else
// the build drew there, because both readings carry it.
//
// WHAT IS COMPARED WHEN A CHECK ASKS WHETHER THE SEEDED ART WAS DRAWN IS THE
// ALPHA SILHOUETTE, NOT THE PIXELS. `specs/assets.md` asks for one silhouette in
// two band-states and leaves the build the route: it may composite the band's
// colour over the seeded PNG at draw time, or bake a per-band copy once at load
// and blit that. Under the second route the bitmap handed to `drawImage` is the
// build's own canvas and its COLOURS are the build's, but its SHAPE is still the
// seeded one — so the shape is what a sprite check reads, and the harness's own
// `nearestSeededSprite`, which holds a source's PIXELS against the seeded file,
// is not what this group uses. The agreement is a number rather than a verdict;
// the fraction a check will accept is that check's own figure.
//
// EVERYTHING HERE IS ARITHMETIC OVER READINGS THE HARNESS ALREADY TOOK. The
// pixels come from its `regionPixels` and its `device`, the blits from its
// `drawnImages`, and the seeded shapes from its `silhouetteOf`, `maskAgreement`
// and `seededSilhouette`, off the same `assets/` tree it serves the build from.

import { fail } from "../assert";
import {
  SPRITE_NAMES,
  colorDistance,
  distanceBetween,
  drawnImages,
  maskAgreement,
  regionPixels,
  seededSilhouette,
  silhouetteOf,
  type BulletSnapshot,
  type DrawnImage,
  type DroneSnapshot,
  type Harness,
  type Rgb,
  type SpectraSnapshot,
  type SpriteName,
} from "../harness";

/* -------------------------------------------------------------------------- */
/* The boxes a check reads through                                            */
/* -------------------------------------------------------------------------- */

/** A rectangle of the stage, in logical units, by its CENTRE and its extent. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The square of stage a body of footprint `size` occupies, centred on `(x, y)`. */
export function footprintOf(x: number, y: number, size: number): Box {
  return { x, y, w: size, h: size };
}

/** The box a body drawn `w` by `h` occupies, centred on `(x, y)`. */
export function boxOf(x: number, y: number, w: number, h: number): Box {
  return { x, y, w, h };
}

/* -------------------------------------------------------------------------- */
/* One reading of one box                                                     */
/* -------------------------------------------------------------------------- */

/** One reading of a box: its pixels, and the device grid they landed on. */
export interface Region {
  /** RGBA bytes, row by row, as `regionPixels` copied them. */
  data: Uint8ClampedArray;
  /** Device pixels across the box. */
  width: number;
  /** Device pixels down it. */
  height: number;
}

/**
 * Every device pixel inside a logical box, with the grid it landed on.
 *
 * The pixels are the harness's {@link regionPixels}; what is added here is the
 * shape of that grid, mapped through the harness's own `device` so it names the
 * same box the reading was taken over — which is what lets two readings of one
 * box be held against each other place for place, and lets a failure say how many
 * places that was.
 */
export function readRegion(h: Harness, box: Box): Region {
  const from = h.device(box.x - box.w / 2, box.y - box.h / 2);
  const to = h.device(box.x + box.w / 2, box.y + box.h / 2);
  return {
    data: regionPixels(h, box.x, box.y, box.w, box.h),
    width: Math.max(1, to.x - from.x),
    height: Math.max(1, to.y - from.y),
  };
}

/* -------------------------------------------------------------------------- */
/* What counts as painted                                                     */
/* -------------------------------------------------------------------------- */

/**
 * How far a place must move between the two readings to count as painted, as a
 * Euclidean RGB distance out of the `441` an RGB cube is across.
 *
 * THIS IS THE READING, NOT A THRESHOLD: it decides which places of a region count
 * as drawn on, and it is the whole of what a region check asserts. Two readings of
 * one place nothing was drawn on are identical, so anything above zero would do to
 * separate painted from unpainted; `12` is a little above the rounding one
 * composite can put on a pixel, so a faint glow a build lays around a body counts
 * as part of it and an untouched pixel never does.
 */
export const PAINT_MIN = 12;

/** Two readings of one box, or a failure naming the pair that disagreed. */
function sameLattice(a: Region, b: Region): number {
  if (
    a.width !== b.width ||
    a.height !== b.height ||
    a.data.length !== b.data.length
  ) {
    fail(
      `two readings of the same box (${a.width}x${a.height}, ` +
        `${a.data.length} bytes)`,
      `${b.width}x${b.height}, ${b.data.length} bytes`,
    );
  }
  return a.data.length / 4;
}

/** The colour of the place at `pixel` of a region already read. */
function colorOf(region: Region, pixel: number): Rgb {
  const at = pixel * 4;
  return { r: region.data[at], g: region.data[at + 1], b: region.data[at + 2] };
}

/** Whether the place at `pixel` moved between the two readings. */
function movedAt(bare: Region, now: Region, pixel: number): boolean {
  return colorDistance(colorOf(bare, pixel), colorOf(now, pixel)) > PAINT_MIN;
}

/* -------------------------------------------------------------------------- */
/* What a thing painted                                                       */
/* -------------------------------------------------------------------------- */

/**
 * How many places of a region a thing painted: the places that moved between a
 * reading taken with the thing on the field and a reading of the same region
 * with the thing gone.
 *
 * The reading every region check in this group takes. A thing that painted
 * nothing reports `0`, which is the failure those checks name.
 */
export function paintedCount(bare: Region, now: Region): number {
  const total = sameLattice(bare, now);
  let count = 0;
  for (let pixel = 0; pixel < total; pixel += 1) {
    if (movedAt(bare, now, pixel)) count += 1;
  }
  return count;
}

/* -------------------------------------------------------------------------- */
/* What shape the build blitted                                               */
/* -------------------------------------------------------------------------- */

/** Every place reported as unpainted: what a source that would not raster scores. */
const NO_SILHOUETTE = new Uint8Array(0);

/** One bitmap a frame blitted, with the shape it took. */
export interface Blit extends DrawnImage {
  /** The source's own alpha silhouette, for comparing two draws with each other. */
  silhouette: Uint8Array;
  /** How closely that silhouette agrees with each seeded sprite's, `0` to `1`. */
  agreement: Readonly<Record<SpriteName, number>>;
  /** The source rasterized at all. A source that would not scores every sprite `0`. */
  captured: boolean;
}

/** A drawn source's silhouette, or every place off where it would not raster. */
function shapeOf(source: { width: number; height: number }): Uint8Array {
  try {
    return silhouetteOf(source);
  } catch {
    return NO_SILHOUETTE;
  }
}

/**
 * Run one frame and hand back every bitmap it blitted, each with its silhouette.
 *
 * The reading every silhouette check in this group opens with. The recorded call
 * list is emptied first, so what comes back is the blits of ONE frame — the frame
 * the check's arrangement produced — and not the frames the harness drew getting
 * there. Each `drawImage` is placed through the harness's own {@link drawnImages},
 * so where a draw landed is mapped back to logical units through whatever
 * transform the build made it under.
 */
export async function blitsOfFrame(h: Harness): Promise<Blit[]> {
  h.calls.length = 0;
  await h.advance(1);
  const sprites = {} as Record<SpriteName, Uint8Array>;
  for (const name of SPRITE_NAMES) sprites[name] = await seededSilhouette(name);
  return drawnImages(h).map((image) => {
    const silhouette = shapeOf(image.source);
    const agreement = {} as Record<SpriteName, number>;
    for (const name of SPRITE_NAMES) {
      agreement[name] = maskAgreement(sprites[name], silhouette);
    }
    return {
      ...image,
      silhouette,
      agreement,
      captured: silhouette.length > 0,
    };
  });
}

/** How closely two drawn sources' own silhouettes agree, `0` to `1`. */
export function silhouetteAgreement(a: Uint8Array, b: Uint8Array): number {
  return maskAgreement(a, b);
}

/** Every blit whose destination box is centred within `within` units of a point. */
export function blitsNear(
  blits: readonly Blit[],
  at: { x: number; y: number },
  within: number,
): Blit[] {
  return blits
    .filter((blit) => distanceBetween(blit, at) <= within)
    .sort((a, b) => distanceBetween(a, at) - distanceBetween(b, at));
}

/**
 * The blit of a run that agrees best with one seeded sprite.
 *
 * Which draw a check is about, when a build is free to lay a glow, a shadow or a
 * halo of its own around a body and blit that too: the one that looks most like
 * the seeded art is the one the entity is claimed to be drawn from, and the check
 * states how closely it must agree.
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
 * What a run of blits drew, as a failure message names it: each one's destination
 * box, the size of the source behind it, and how closely that source agrees with
 * each seeded sprite.
 */
export function describeBlits(blits: readonly Blit[]): string {
  if (blits.length === 0) return "no bitmap was blitted there";
  return blits
    .map((blit) => {
      const scores = SPRITE_NAMES.map(
        (name) => `${name} ${blit.agreement[name].toFixed(3)}`,
      ).join(", ");
      const source = blit.captured
        ? `${blit.source.width}x${blit.source.height} source`
        : "a source the reading could not raster";
      return (
        `a ${blit.w.toFixed(1)}x${blit.h.toFixed(1)} box from a ${source} ` +
        `(${scores})`
      );
    })
    .join("; ");
}

/* -------------------------------------------------------------------------- */
/* The entity a check is about                                                */
/* -------------------------------------------------------------------------- */

/**
 * The drone with that id, or the failure that the roster no longer holds it.
 *
 * Every drone this group poses is a prop with every faculty off, standing on an
 * empty field behind three shut world gates, so a drone that is gone by the frame
 * that is read is a build that removed something nothing asked it to remove — a
 * failure of the point, named as one, rather than a field read off nothing.
 */
export function droneOf(snapshot: SpectraSnapshot, id: number): DroneSnapshot {
  const drone = snapshot.drones.find((live) => live.id === id);
  if (drone === undefined) {
    fail(
      `the posed drone ${id} still standing on the field when the frame was read`,
      `drones ${JSON.stringify(snapshot.drones.map((live) => live.id))}`,
    );
  }
  return drone;
}

/** The bullet with that id, or the failure that the roster no longer holds it. */
export function bulletOf(
  snapshot: SpectraSnapshot,
  id: number,
): BulletSnapshot {
  const bullet = snapshot.bullets.find((live) => live.id === id);
  if (bullet === undefined) {
    fail(
      `the posed bullet ${id} still in flight when the frame was read`,
      `bullets ${JSON.stringify(snapshot.bullets.map((live) => live.id))}`,
    );
  }
  return bullet;
}
