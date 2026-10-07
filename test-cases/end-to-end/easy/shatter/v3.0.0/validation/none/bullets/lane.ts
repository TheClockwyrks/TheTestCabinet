// bullets — reading what the build painted along one horizontal lane of the
// field. Local to this group.
//
// WHY THIS IS HERE AND NOT IN THE HARNESS. Two items in this group
// (`trail-drawn` and `trail-follows-the-wrap`) have to decide where on the canvas
// a build drew a bullet's tail, and no other group in this project asks that
// question. The harness already carries the two primitives it takes —
// `Harness.scanDevice`, which reads a whole line of the backing store in one
// crossing, and `Harness.viewport`, which says where a logical point lands — so
// what is left is the small amount of arithmetic that turns two readings of the
// same line into "which columns changed", and that lives beside the checks that
// read it.
//
// WHY A LINE RATHER THAN A HANDFUL OF POINTS. A tail is a thin streak, and the
// question `trail-follows-the-wrap` asks is a question about EVERY drawn pixel
// of it — "no drawn part of it is further from the bullet than `TRAIL_TICKS` of
// the bullet's travel by the shortest wrapped separation" (`specs/weapons.md`).
// A build that smears its tail across the field instead of following the bullet
// over the seam paints hundreds of columns this reading sees and a five-point
// sample would walk straight past.
//
// WHY THE CONTROL IS THE SAME FRAME WITH THE BULLET TAKEN OFF IT.
// `specs/overview.md` fixes no palette and leaves the whole look to the build,
// so there is no colour to hold a reading against: the only honest control is
// the same canvas, at the same simulation time, without the thing being looked
// for. {@link bulletLane} reads the lane, removes the one bullet through
// `removeBullet`, and reads the same lane again with nothing advanced, so the
// star, the ship and the HUD stand exactly where they stood and what changed is
// what the bullet and its tail drew, plus whatever the build's own drawing does
// to the lane from one presented frame to the next.
//
// WHY THE SPREAD OF IDLE FRAMES IS MEASURED. That last term is the build's to
// choose: a twinkling starfield, a dithered vignette, a pulsing readout are all
// legal appearance, and each of them moves a few pixels of the lane between two
// presented frames of the same simulation time with no bullet on the field at
// all. A claim that NOTHING was drawn somewhere therefore takes its bound from a
// measurement rather than a figure: the lane is read over several more frames
// after the bullet is gone, and the most any column moved between one and the
// next is what the build's own drawing does to the lane by itself
// ({@link LanePair.spread}). A claim that SOMETHING was drawn keeps its floor —
// noise can only ever add to a presence reading, never take from it.
//
// NO THRESHOLD LIVES HERE. What counts as "changed" is each check's own figure,
// stated in the check beside the specification rule it serves.

import type { Harness } from "../harness";

/**
 * The device rows one lane reading covers: the row the lane runs along, and one
 * either side.
 *
 * A tail is drawn as a stroked path whose width `specs/weapons.md` leaves to the
 * build, tapering "to nothing at its oldest end", so its oldest reaches can be
 * thinner than one device pixel and land half on the row and half on its
 * neighbour. Three rows, read for the largest change any of them carries, means a
 * sub-pixel streak is still seen where a single row could miss it.
 */
export const LANE_ROWS = [-1, 0, 1] as const;

/** One reading of a lane: the channel-mean brightness of each of its rows. */
export type Lane = number[][];

/** Read the lane through the logical `y`, as {@link LANE_ROWS} device rows. */
export async function readLane(h: Harness, y: number): Promise<Lane> {
  const centre = Math.round(h.device(0, y).y);
  const rows: Lane = [];
  for (const offset of LANE_ROWS) {
    rows.push(await h.scanDevice("row", centre + offset));
  }
  return rows;
}

/** How far one column of the lane moved between two readings, at its brightest row. */
export function laneChange(before: Lane, after: Lane, column: number): number {
  let most = 0;
  for (let row = 0; row < before.length && row < after.length; row += 1) {
    const was = before[row][column];
    const now = after[row][column];
    if (was === undefined || now === undefined) continue;
    most = Math.max(most, Math.abs(now - was));
  }
  return most;
}

/**
 * The largest change any column within `spread` of `column` carries.
 *
 * A station on a lane names a logical point, and a stroked path a couple of units
 * wide lands on the device columns around it rather than exactly on one, so a
 * station is read as a short run of columns rather than as a single one.
 */
export function laneChangeNear(
  before: Lane,
  after: Lane,
  column: number,
  spread: number,
): number {
  const width = Math.min(before[0]?.length ?? 0, after[0]?.length ?? 0);
  let most = 0;
  for (let at = column - spread; at <= column + spread; at += 1) {
    if (at < 0 || at >= width) continue;
    most = Math.max(most, laneChange(before, after, at));
  }
  return most;
}

/** Every column of the lane that moved by more than `threshold` between two readings. */
export function changedColumns(
  before: Lane,
  after: Lane,
  threshold: number,
): number[] {
  const width = Math.min(before[0]?.length ?? 0, after[0]?.length ?? 0);
  const columns: number[] = [];
  for (let column = 0; column < width; column += 1) {
    if (laneChange(before, after, column) > threshold) columns.push(column);
  }
  return columns;
}

/** The logical `x` a device column of the lane stands at. */
export function laneX(h: Harness, column: number): number {
  const view = h.viewport();
  return (column - view.offsetX) / view.scale;
}

/** What a lane looks like with a bullet on it, and what it looks like without. */
export interface LanePair {
  /** The lane as the build painted it with the bullet and its tail in flight. */
  drawn: Lane;
  /** The same lane, at the same simulation time, with that bullet removed. */
  bare: Lane;
  /**
   * The most any column of the lane moved between two presented frames of the
   * same simulation time with no bullet on the field, in channel-mean
   * brightness out of 255.
   *
   * What the build's own drawing does to the lane by itself, frame to frame.
   * `0` for a build that presents an unchanged state the same way every frame.
   */
  spread: number;
}

/**
 * How many idle frames the lane is read over after the bullet is gone, so the
 * spread is taken from several frames rather than from one pair.
 */
const IDLE_FRAMES = 4;

/**
 * Read the lane through `y` as it stands, then with the bullet `id` taken off
 * the field, then over {@link IDLE_FRAMES} further presented frames for the
 * lane's own spread.
 *
 * Nothing advances between any two readings, so every other body, readout and
 * backdrop stands where it stood, and the difference between the first two is
 * the bullet's own drawing — its disc and the tail `specs/weapons.md` requires
 * behind it — plus what the build's presenter changes on its own.
 */
export async function bulletLane(
  h: Harness,
  y: number,
  id: number,
): Promise<LanePair> {
  const drawn = await readLane(h, y);
  await h.debug.removeBullet(id);
  const bare = await readLane(h, y);

  let spread = 0;
  let previous = bare;
  for (let frame = 0; frame < IDLE_FRAMES; frame += 1) {
    const idle = await readLane(h, y);
    spread = Math.max(spread, laneUnrest(previous, idle));
    previous = idle;
  }
  return { drawn, bare, spread };
}

/** The most any column of the lane moved between two readings. */
function laneUnrest(before: Lane, after: Lane): number {
  const width = Math.min(before[0]?.length ?? 0, after[0]?.length ?? 0);
  let most = 0;
  for (let column = 0; column < width; column += 1) {
    most = Math.max(most, laneChange(before, after, column));
  }
  return most;
}

/**
 * The bound a claim that nothing was drawn holds a column to: `floor`, or twice
 * the lane's measured {@link LanePair.spread} where that is more.
 *
 * Twice, because the spread is the largest move a handful of idle frames showed
 * and the frame under test is one more draw from the same unrest: a bound set at
 * the spread itself would be crossed by chance about as often as any one of the
 * idle frames set it. Doubling it puts a conformant build's noise well inside,
 * and a tail drawn where none should be still reads far above it.
 */
export function absenceBound(lane: LanePair, floor: number): number {
  return Math.max(floor, 2 * lane.spread);
}
