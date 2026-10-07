// Fathom — the sonar wavefront.
//
// A pulse is not an expanding circle. It travels outward through the corridors,
// bending at bends and stopping at rock, so it reaches near tiles before far
// ones (`specs/sensing.md`). The geometry is the corridor flood grouped by
// distance; this module turns that static geometry into a moving front the game
// reveals and hit-tests against, and the renderer draws as a travelling crest.

import { GRID_COLS, SONAR_WAVE_SPEED } from "./constants";
import type { Maze } from "./maze";
import type { Cell, PulseSource, PulseTint } from "./types";
import { tileKey } from "./sensing";

/** What a caller asks for when it casts a pulse. */
export interface PulseSpec {
  source: PulseSource;
  tint: PulseTint;
  /** The tile the pulse is cast from. */
  origin: Cell;
  /** The furthest the front will travel, in corridor steps. */
  range: number;
  /** Whether the front reveals and remembers the tiles it sweeps over. */
  reveals: boolean;
  /** The index of the predator that cast it, or `null` for the forager. */
  emitter: number | null;
}

export class SonarWave {
  readonly source: PulseSource;
  readonly tint: PulseTint;
  readonly origin: Cell;
  readonly range: number;
  readonly reveals: boolean;
  readonly emitter: number | null;

  /** Corridor tiles the flood reached, indexed by distance from the origin. */
  readonly buckets: Cell[][];

  /** Corridor distance from the origin, per tile the flood reached. */
  private readonly distance = new Map<number, number>();

  /**
   * The direction the sound is travelling through each tile: the average of the
   * steps from every tile one corridor step closer to the origin. On a straight
   * run that is the corridor's axis, and at a bend it swings onto the new
   * heading, so the drawn crest bulges the way the pulse is actually moving.
   */
  private readonly travel = new Map<number, { x: number; y: number }>();

  /** How far the front has travelled, in corridor steps. */
  front = 0;

  /** Where the front stood when this step began, for the renderer to read. */
  prevFront = 0;

  /** The highest bucket already handed to the caller. */
  private surfacedTo = -1;

  /** Predator indices the front has already swept over. */
  readonly sweptPredators = new Set<number>();

  /** Whether the front has already reached the forager. */
  caughtForager = false;

  constructor(maze: Maze, spec: PulseSpec) {
    this.source = spec.source;
    this.tint = spec.tint;
    this.origin = { ...spec.origin };
    this.range = spec.range;
    this.reveals = spec.reveals;
    this.emitter = spec.emitter;
    this.buckets = maze.floodBuckets(
      spec.origin.col,
      spec.origin.row,
      spec.range,
    );

    for (let d = 0; d < this.buckets.length; d++) {
      for (const cell of this.buckets[d]) {
        this.distance.set(tileKey(cell.col, cell.row), d);
      }
    }
    for (const [key, d] of this.distance) {
      if (d === 0) {
        this.travel.set(key, { x: 0, y: 0 });
        continue;
      }
      const col = key % GRID_COLS;
      const row = (key - col) / GRID_COLS;
      let vx = 0;
      let vy = 0;
      for (const [dc, dr] of UPSTREAM_OFFSETS) {
        // The neighbor this tile would have been reached from. Wrap-tunnel
        // neighbors are skipped: their offset is not a unit step, so including
        // one would swing the drawn crest off across the board.
        const upstream = (row - dr) * GRID_COLS + (col - dc);
        if (this.distance.get(upstream) === d - 1) {
          vx += dc;
          vy += dr;
        }
      }
      const m = Math.hypot(vx, vy);
      this.travel.set(key, m > 0 ? { x: vx / m, y: vy / m } : { x: 0, y: 0 });
    }
  }

  /**
   * Advance the front by `dt`, returning the buckets it newly swept over,
   * nearest first, so the caller reveals terrain and marks hunters exactly as
   * the front reaches them rather than all at once.
   */
  advance(dt: number): Cell[][] {
    this.prevFront = this.front;
    this.front += SONAR_WAVE_SPEED * dt;
    const reachTo = Math.min(this.buckets.length - 1, Math.floor(this.front));
    const crossed: Cell[][] = [];
    for (let d = this.surfacedTo + 1; d <= reachTo; d++)
      crossed.push(this.buckets[d]);
    this.surfacedTo = Math.max(this.surfacedTo, reachTo);
    return crossed;
  }

  /** Collapse the interpolation window, after a jump rather than a step. */
  syncView(): void {
    this.prevFront = this.front;
  }

  /** Where the front stands part-way through the current step, for drawing. */
  viewFront(alpha: number): number {
    return this.prevFront + (this.front - this.prevFront) * alpha;
  }

  /** The corridor distance to a tile, or `null` where the flood never reached. */
  distanceTo(col: number, row: number): number | null {
    return this.distance.get(tileKey(col, row)) ?? null;
  }

  /** The heading the crest carries through a tile, for the renderer. */
  travelThrough(col: number, row: number): { x: number; y: number } | null {
    return this.travel.get(tileKey(col, row)) ?? null;
  }

  /** Whether the front has swept past a tile. */
  reached(col: number, row: number): boolean {
    const d = this.distance.get(tileKey(col, row));
    return d !== undefined && this.front >= d;
  }

  /** A pulse leaves the list once its front passes its range. */
  get done(): boolean {
    return this.front > this.range;
  }
}

const UPSTREAM_OFFSETS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
