// bullets — reading what the build painted along one horizontal lane of the
// field. Local to this group.
//
// WHY THIS IS HERE AND NOT IN THE HARNESS. Two items in this group
// (`trail-drawn` and `trail-follows-the-wrap`) have to decide WHERE ON THE CANVAS
// a build drew a round's tail, and no other group in this case asks that
// question. The harness already carries the two primitives it takes — the real 2D
// context, for `getImageData`, and `h.device`, which maps a logical point through
// the world's camera and the engine's fit into the backing store — so what is left
// is the arithmetic that turns two readings of the same band into "which columns
// changed", and that lives beside the checks that read it.
//
// WHY THE PIXELS AND NOT THE RECORDED CALLS. `h.calls` says which drawing
// operations a frame issued, which is the sharper reading for a build that draws
// its tail as a path. But `specs/weapons.md` requires a fading tail and fixes
// nothing about how it is drawn, and a build is free to lay it down as a
// gradient-filled shape, a run of strokes, a stamped sprite, or a single wide
// line — and only one of those leaves the tail's own extent in the coordinates
// of its calls. What every one of them leaves is PIXELS on the canvas, along the
// path the round came down, so that is what these read.
//
// WHY A BAND OF ROWS RATHER THAN A HANDFUL OF POINTS. A tail is a thin streak,
// and the question `trail-follows-the-wrap` asks is a question about EVERY drawn
// pixel of it — "no drawn part of it is further from the bullet than
// `TRAIL_TICKS` of the bullet's travel by the shortest wrapped separation"
// (`specs/weapons.md`). A build that smears its tail across the field instead of
// following the round over the seam paints hundreds of columns this reading sees
// and a five-point sample would walk straight past. The band is several device
// rows deep because `specs/weapons.md` leaves the tail's width to the build and
// has it taper "to nothing at its oldest end", so its oldest reaches can be
// thinner than a device pixel and land half on one row and half on its
// neighbour; and because the well bends a round flown across the field by a unit
// or so over the span a tail covers.
//
// WHY THE CONTROL IS THE SAME FLIGHT FLOWN TWICE. `specs/overview.md` fixes no
// palette and leaves the whole look to the build, so there is no colour to hold a
// reading against: the only honest control is the same canvas, at the same moment
// of the same game, without the thing being looked for. {@link trailLane} flies
// the scenario once with the round and once without, and each run begins with
// `reset({ seed })` — which `specs/instrumentation.md` returns every declared
// field to its title value and `simTime` to `0`, and which reseeds every draw the
// game makes. The two runs therefore reach the same tick of the same seeded game
// holding the same world, and the render-free simulation core
// `specs/simulation.md` fixes makes the two frames identical but for the round
// and its tail. Nothing the build draws from the clock — a blinking readout, a
// pulsing halo, a HUD wherever it chose to put it — can read as a trail, because
// it is drawn identically in both.
//
// EVERY LANE IN THIS GROUP IS HORIZONTAL AND EVERY ROUND ON ONE TRAVELS ALONG
// `+x`, so "behind" is `-x` and a distance along the lane is a distance along
// the round's own travel. That is the checks' choice, not a limitation written
// in here: it is what makes a reading in device columns a reading in units of
// travel.
//
// NO THRESHOLD LIVES HERE. What counts as "changed", how far a reading may skip
// and still be one streak, and how long a tail must be are each check's own
// figures, stated in the check beside the specification rule it serves.

import { FIELD_W } from "../constants";
import { DEFAULT_SEED } from "../surface";
import { fail } from "../assert";
import { shortestDelta } from "../geometry";
import { poseBullet, resetTo, startPlaying, type Harness } from "../harness";
import type { BulletSnapshot } from "../surface";

/**
 * How a logical `x` on the lane and a device column of the backing store map
 * onto one another.
 *
 * Derived from two probes of `h.device` rather than read off the engine's
 * viewport, because `h.device` is the mapping this harness documents — it
 * carries a point through the world's CAMERA as well as the engine's fit, so a
 * build that moved its camera is read where it actually drew. The map is affine
 * because both stages are, and two probes a field apart pin it.
 */
export interface LaneMap {
  /** Device columns per logical unit. */
  readonly scale: number;
  /** The device column logical `x = 0` lands on. */
  readonly originColumn: number;
}

/** The map for the lane at logical row `y`. */
export function laneMap(h: Harness, y: number): LaneMap {
  const left = h.device(0, y).x;
  const right = h.device(FIELD_W, y).x;
  const scale = (right - left) / FIELD_W;
  if (!(scale > 0)) {
    fail(
      "the canvas to map a logical x onto a device column with a positive " +
        "scale, so the lane can be read at all",
      scale,
    );
  }
  return { scale, originColumn: left };
}

/** Where a logical `x` lands in the backing store, as a device column. */
export function deviceColumn(map: LaneMap, x: number): number {
  return Math.round(map.originColumn + x * map.scale);
}

/** The logical `x` a device column stands at. */
export function logicalX(map: LaneMap, column: number): number {
  return (column - map.originColumn) / map.scale;
}

/** One reading of a band of device rows: the raw RGBA bytes of each row. */
export interface Lane {
  /** Each row of the band, as `RGBA` bytes across the whole backing store. */
  readonly rows: readonly Uint8ClampedArray[];
  /** How many device columns each row holds. */
  readonly width: number;
}

/** What a lane looks like with a round on it, and what it looks like without. */
export interface LanePair {
  /** The band as the build painted it with the round and its tail in flight. */
  readonly drawn: Lane;
  /** The same band, in the same posed world, with that round removed. */
  readonly bare: Lane;
}

/**
 * Read the band of device rows covering `halfHeight` logical units either side
 * of the logical row `y`.
 */
export function readLane(h: Harness, y: number, halfHeight: number): Lane {
  const top = Math.max(0, h.device(0, y - halfHeight).y);
  const bottom = Math.min(h.canvas.height - 1, h.device(0, y + halfHeight).y);
  const height = Math.max(1, bottom - top + 1);
  const width = h.canvas.width;
  const image = h.ctx.getImageData(0, top, width, height);
  const rows: Uint8ClampedArray[] = [];
  for (let row = 0; row < height; row += 1) {
    rows.push(image.data.slice(row * width * 4, (row + 1) * width * 4));
  }
  return { rows, width };
}

/** The lane a flight is read along. */
export interface LaneBand {
  /** The logical row the lane runs along. */
  y: number;
  /** How far either side of it the band reaches, in logical units. */
  halfHeight: number;
}

/** One round's flight along that lane: where it starts, how fast, and for how long. */
export interface Flight {
  /** Where the round is placed, in logical units along the lane. */
  x: number;
  /** How fast it travels along `+x`, in logical units per second. */
  speed: number;
  /** How many whole ticks it is flown for before the band is read. */
  ticks: number;
}

/** A flight's two readings, the round as it stood, and the lane's device map. */
export interface TrailReading {
  /** The band with the round and its tail on it, and the same band without. */
  pair: LanePair;
  /** The round the drawn band holds, as the snapshot reported it. */
  round: BulletSnapshot;
  /** How a logical `x` on that lane maps onto a device column. */
  map: LaneMap;
}

/**
 * Fly `flight` along `lane` twice — once with the round on the field and once
 * with the field bare — and read the band at the end of each.
 *
 * Each run opens with `reset({ seed })` and `startPlaying`, so the two reach the
 * same tick of the same seeded game with the same world, and the only difference
 * between the two frames is the round this reads.
 *
 * The bare run goes FIRST, so the reading the check is about is the frame left on
 * the canvas when this returns — which is the frame `captureStill` keeps.
 */
export async function trailLane(
  h: Harness,
  lane: LaneBand,
  flight: Flight,
): Promise<TrailReading> {
  const run = async (round: boolean): Promise<Lane> => {
    resetTo(h, DEFAULT_SEED);
    startPlaying(h);
    if (round) poseBullet(h, flight.x, lane.y, flight.speed, 0);
    await h.advance(flight.ticks);
    return readLane(h, lane.y, lane.halfHeight);
  };

  const bare = await run(false);
  const drawn = await run(true);
  const round = h.snapshot().bullets[0];
  if (round === undefined) {
    fail(
      `the round this scenario placed still in flight after ${flight.ticks} ` +
        `ticks, which is well inside BULLET_LIFE (specs/weapons.md, ` +
        `specs/instrumentation.md: addBullet gives a placed round a full life)`,
      "an empty bullet roster",
    );
  }
  return { pair: { drawn, bare }, round, map: laneMap(h, lane.y) };
}

/** How far one column of the band moved between the two readings, at its furthest row. */
export function laneChange(pair: LanePair, column: number): number {
  if (column < 0 || column >= pair.bare.width) return 0;
  let most = 0;
  const rows = Math.min(pair.bare.rows.length, pair.drawn.rows.length);
  for (let row = 0; row < rows; row += 1) {
    const at = column * 4;
    const was = pair.bare.rows[row];
    const now = pair.drawn.rows[row];
    most = Math.max(
      most,
      Math.hypot(
        now[at] - was[at],
        now[at + 1] - was[at + 1],
        now[at + 2] - was[at + 2],
      ),
    );
  }
  return most;
}

/** Every device column of the band that moved by more than `threshold`. */
export function litColumns(pair: LanePair, threshold: number): number[] {
  const columns: number[] = [];
  for (let column = 0; column < pair.bare.width; column += 1) {
    if (laneChange(pair, column) > threshold) columns.push(column);
  }
  return columns;
}

/** How far a reading walks along the lane, and how far it may skip. */
export interface ReachOptions {
  /** How far from the round the walk starts, in logical units. */
  from: number;
  /** How far from the round the walk gives up, in logical units. */
  to: number;
  /** How far a column must move to count as drawn. */
  threshold: number;
  /** The widest unlit run a streak may contain and still be one streak, in units. */
  gap: number;
}

/**
 * How far a run of drawn columns reaches from `x` in the direction `sign`,
 * in logical units, allowing unlit runs no wider than `gap`.
 *
 * The walk is taken in DEVICE columns and answered in logical units, so a
 * reading means the same thing whatever the letterbox did to the scale.
 *
 * IT DOES NOT WRAP. A walk that runs off either end of the backing store reads
 * unlit columns and stops on the gap, so this answers a round standing clear of
 * both seams. A check about a round AT a seam reads {@link furthestDrawn}
 * instead, which measures across them.
 */
export function reachAlong(
  map: LaneMap,
  pair: LanePair,
  x: number,
  sign: 1 | -1,
  options: ReachOptions,
): number {
  const origin = deviceColumn(map, x);
  const first = Math.max(1, Math.round(options.from * map.scale));
  const last = Math.round(options.to * map.scale);
  const gap = Math.max(0, options.gap * map.scale);

  let reach = 0;
  let since = 0;
  for (let step = first; step <= last; step += 1) {
    if (laneChange(pair, origin + sign * step) > options.threshold) {
      reach = step / map.scale;
      since = 0;
    } else {
      since += 1;
      if (since > gap) break;
    }
  }
  return reach;
}

/**
 * The furthest any drawn column of the band lies from the round, by the shortest
 * wrapped separation along `x` (`specs/field.md`), and where that column was.
 *
 * The whole band is walked rather than a run from the round outward, which is
 * what makes it a reading about EVERY drawn pixel: a build that smeared its tail
 * back across the field lights columns this answers on, however far they are
 * from anything the round is doing.
 */
export function furthestDrawn(
  map: LaneMap,
  pair: LanePair,
  x: number,
  threshold: number,
): { distance: number; x: number } {
  let furthest = { distance: 0, x };
  for (const column of litColumns(pair, threshold)) {
    const at = logicalX(map, column);
    const away = Math.abs(shortestDelta(x, at, FIELD_W));
    if (away > furthest.distance) furthest = { distance: away, x: at };
  }
  return furthest;
}
