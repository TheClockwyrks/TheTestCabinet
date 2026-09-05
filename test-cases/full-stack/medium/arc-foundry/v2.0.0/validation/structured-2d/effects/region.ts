// Arc Foundry — reading a patch of the yard, for the points about the produced
// electrical effects. CASE-PROVIDED.
//
// WHAT AN EFFECT LOOKS LIKE FROM OUTSIDE THE BUILD. `specs/assets.md` says where
// each of the twelve systems is spawned — at the stamped footprint, along the line
// from a firing head to its target, centred on an Arc-Node's impact point, on the
// unit carrying a slow — and it says each "is played live and simulated as it
// plays, so it varies from one firing to the next". So an effect is two things a
// canvas can be asked about: something is drawn WHERE the specification puts it,
// and what is drawn there MOVES, frame after frame, in a way a standing sprite
// does not.
//
// THE TWO READINGS BELOW ARE EXACTLY THOSE.
//
//   `read` samples a set of logical points and hands back one comparable string.
//   A validator uses it to ask whether a place looks different from how it looked
//   before the event — the form the review items are written in ("particles are
//   drawn ... that were not drawn there on the frame before it").
//
//   `motion` counts, over a run of frames, how many of them changed the region.
//   That is the reading for a place where something has also APPEARED — a rock
//   lands on the footprint the spark plays at, a combine puts a new structure
//   where the flash plays — and the appearance alone would satisfy a
//   before-and-after comparison. A posed yard with nothing playing on it is
//   static frame to frame, so a region that keeps changing is a region something
//   is being simulated in.
//
// SAMPLED ON A LATTICE, NEVER AT A POINT. A system spawns its particles at
// random within its emitters' shapes, so one pixel is a coin toss and a lattice
// over the whole place the specification names is not. Every region below is
// derived from a figure the specs fix — a `2` by `2` footprint, the line between a
// head and its target, an Arc-Node's splash radius — and never from anything the
// reference happens to draw.
//
// COMPARED EXACTLY. The harness steps the game itself, so two frames that drew the
// same picture are byte-identical and there is nothing to tolerance away. At the
// default harness shape the viewport is the identity, so a logical point is a
// canvas pixel and every reading below is a straight synchronous read of the frame
// the engine has just drawn.

import { captureStill, type FoundrySnapshot, type Harness } from "../harness";
import type { Point } from "../constants";

/** A square lattice about `center`, `half` either side, `step` apart. */
export function lattice(center: Point, half: number, step: number): Point[] {
  const points: Point[] = [];
  for (let dy = -half; dy <= half; dy += step) {
    for (let dx = -half; dx <= half; dx += step) {
      points.push({ x: center.x + dx, y: center.y + dy });
    }
  }
  return points;
}

/** A lattice over the ring between two radii, so a subject inside is left out. */
export function annulus(
  center: Point,
  inner: number,
  outer: number,
  step: number,
): Point[] {
  return lattice(center, outer, step).filter((point) => {
    const d = Math.hypot(point.x - center.x, point.y - center.y);
    return d >= inner && d <= outer;
  });
}

/** `count` points evenly around a circle of `radius` about `center`. */
export function circle(center: Point, radius: number, count: number): Point[] {
  return Array.from({ length: count }, (_unused, i) => {
    const angle = (2 * Math.PI * i) / count;
    return {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    };
  });
}

/**
 * Points on the segment from `a` to `b`, keeping clear of both ends.
 *
 * `clearance` is how far from each end the sampling starts, so a segment between
 * two things — a firing head and the unit it is shooting at, two units a chain
 * strikes — is read where only what was drawn BETWEEN them can appear.
 */
export function between(
  a: Point,
  b: Point,
  clearance: number,
  count: number,
): Point[] {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const from = clearance / length;
  const to = 1 - clearance / length;
  return Array.from({ length: count }, (_unused, i) => {
    const t = from + ((to - from) * i) / (count - 1);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  });
}

/** What the canvas holds at those points right now, as one comparable reading. */
export function read(h: Harness, points: readonly Point[]): string {
  return h
    .pixels(points)
    .map((pixel) => pixel.join(","))
    .join(" ");
}

/**
 * How many of the next `frames` frames changed the region, starting from the
 * picture on the frame already drawn.
 *
 * A region with a live system playing in it changes on nearly every frame; a
 * region holding standing sprites alone changes on none.
 */
export async function motion(
  h: Harness,
  points: readonly Point[],
  frames: number,
): Promise<number> {
  let previous = read(h, points);
  let changed = 0;
  for (let i = 0; i < frames; i += 1) {
    await h.advance(1);
    const next = read(h, points);
    if (next !== previous) changed += 1;
    previous = next;
  }
  return changed;
}

/** One reading per frame over `frames` frames, the frame already drawn first. */
export async function scan(
  h: Harness,
  points: readonly Point[],
  frames: number,
): Promise<string[]> {
  const readings = [read(h, points)];
  for (let i = 0; i < frames; i += 1) {
    await h.advance(1);
    readings.push(read(h, points));
  }
  return readings;
}

/**
 * One reading per frame, kept only on the frames `when` accepts.
 *
 * The reading for a place a projectile passes THROUGH: the sample points are the
 * line the trail is drawn along, and the frames the projectile itself is near
 * them are dropped, so what is left in the readings is whatever else was drawn on
 * that line.
 */
export async function scanWhen(
  h: Harness,
  points: readonly Point[],
  frames: number,
  when: (snapshot: FoundrySnapshot) => boolean,
): Promise<string[]> {
  const readings: string[] = [];
  for (let i = 0; i < frames; i += 1) {
    await h.advance(1);
    if (when(h.snapshot())) readings.push(read(h, points));
  }
  return readings;
}

/**
 * Write a point's declared still, and never let taking it decide the point.
 *
 * The three points that read the produced systems off disk are decided by the
 * files alone: a build whose surface cannot be driven must still pass the point
 * about whether it authored twelve systems. So the pose below is evidence for the
 * reviewer and nothing more, and a pose that throws is reported to the console
 * rather than raised.
 */
export async function evidence(
  h: Harness,
  outputId: string,
  pose: () => Promise<void>,
): Promise<void> {
  try {
    await pose();
  } catch (error) {
    // A pose that throws must FAIL the item, not warn and carry on. Capturing
    // the still anyway wrote a picture of an un-posed frame into the declared
    // output, so the reviewer's evidence showed something the item was not
    // about while the point passed on assertions that never read it. A missing
    // still is recorded as absent; a wrong one is not, which makes it worse.
    // `captureReplay` in the harness already works this way -- try/finally with
    // no catch -- and this brings the still onto the same footing.
    throw new Error(
      `arc foundry: could not pose the still for \`${outputId}\`: ${String(error)}`,
    );
  }
  captureStill(h, outputId);
}
