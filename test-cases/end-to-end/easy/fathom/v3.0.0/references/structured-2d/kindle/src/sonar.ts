// Fathom — the sonar wavefront.
//
// A pulse is not an expanding circle (`specs/sensing.md`): it travels outward
// through the corridors, bending at bends and stopping at rock, so it arrives
// at near tiles before far ones. The geometry is the maze's corridor flood
// grouped by distance; this turns that standing geometry into a moving front
// the game reveals and hit-tests against as it sweeps, and that the renderer
// draws as a travelling crest.

import { SONAR_WAVE_SPEED } from "./constants";
import type { Cell } from "./grid";
import { DIRS, cellIndex, offsetOf } from "./grid";
import type { Maze } from "./maze";

/** What cast a wavefront, as the snapshot reports it. */
export type PulseSource = "forager" | "gloamfin";

/** A wavefront's color, as the snapshot reports it. */
export type PulseTint = "cyan" | "violet" | "orange";

/** Which way a wavefront travels as it passes through one tile. */
export interface Heading {
  readonly x: number;
  readonly y: number;
}

const STILL: Heading = { x: 0, y: 0 };

export class SonarPulse {
  readonly source: PulseSource;
  readonly tint: PulseTint;

  /** The tile it was cast from. */
  readonly origin: Cell;

  /** The furthest it will travel, in corridor steps. */
  readonly range: number;

  /** How far the leading edge has travelled from the origin, in steps. */
  front = 0;

  /** The front at the top of this step, so a crest is drawn between the two. */
  previousFront = 0;

  /** Whether the front has already caught the forager, which it does once. */
  caughtForager = false;

  /**
   * Which predator cast it, by its position in the roster, or `null` for the
   * forager's own pulse. The roster's indices are stable for as long as it
   * stands, and a rebuilt roster takes every pulse in flight with it.
   */
  emitterIndex: number | null = null;

  /**
   * The flood, grouped by how many corridor steps out each tile lies: index `d`
   * holds every tile the front reaches in exactly `d` steps. The fog lights the
   * band the crest currently covers from it, and the renderer draws that same
   * band.
   */
  readonly buckets: Cell[][];
  private readonly steps = new Map<number, number>();
  private readonly headings = new Map<number, Heading>();
  private readonly reach: number;
  private surfaced = -1;

  constructor(
    maze: Maze,
    origin: Cell,
    range: number,
    source: PulseSource,
    tint: PulseTint,
  ) {
    this.origin = origin;
    this.range = range;
    this.source = source;
    this.tint = tint;
    this.buckets = maze.floodBuckets(origin, range);
    this.reach = this.buckets.length - 1;
    for (let step = 0; step < this.buckets.length; step++) {
      for (const cell of this.buckets[step]) {
        this.steps.set(cellIndex(cell.tx, cell.ty), step);
      }
    }
    this.chartHeadings(maze);
  }

  /**
   * The way the front moves through each flooded tile, averaged over the
   * neighbors one step closer to the origin. On a straight run that is the
   * corridor's own axis, and at a bend it rotates onto the new heading, so a
   * drawn crest swings round the corner with the sound. The origin has no
   * direction of its own and reads as a full ring.
   */
  private chartHeadings(maze: Maze): void {
    for (let step = 0; step < this.buckets.length; step++) {
      for (const cell of this.buckets[step]) {
        const key = cellIndex(cell.tx, cell.ty);
        if (step === 0) {
          this.headings.set(key, STILL);
          continue;
        }
        let vx = 0;
        let vy = 0;
        for (const dir of DIRS) {
          const back = maze.step(cell.tx, cell.ty, dir);
          if (this.steps.get(cellIndex(back.tx, back.ty)) !== step - 1)
            continue;
          // The front arrived from that neighbor, so it travels the other way.
          const { dtx, dty } = offsetOf(dir);
          vx -= dtx;
          vy -= dty;
        }
        const length = Math.hypot(vx, vy);
        this.headings.set(
          key,
          length > 0 ? { x: vx / length, y: vy / length } : STILL,
        );
      }
    }
  }

  /**
   * Advances the front by `dt` and returns the buckets it newly swept over,
   * nearest first, so the caller reveals terrain and marks hunters exactly as
   * the front reaches them rather than all at once.
   */
  advance(dt: number): Cell[][] {
    this.previousFront = this.front;
    this.front += SONAR_WAVE_SPEED * dt;
    const arrived = Math.min(this.reach, Math.floor(this.front));
    const crossed: Cell[][] = [];
    for (let step = this.surfaced + 1; step <= arrived; step++) {
      crossed.push(this.buckets[step]);
    }
    if (arrived > this.surfaced) this.surfaced = arrived;
    return crossed;
  }

  /** Whether the front has already swept past a tile. */
  reached(tx: number, ty: number): boolean {
    const step = this.steps.get(cellIndex(tx, ty));
    return step !== undefined && this.front >= step;
  }

  /** How far out a tile lies, in corridor steps, or `null` outside the flood. */
  stepsTo(tx: number, ty: number): number | null {
    return this.steps.get(cellIndex(tx, ty)) ?? null;
  }

  /** Which way the front travels through a tile, for the drawn crest. */
  headingAt(tx: number, ty: number): Heading | null {
    return this.headings.get(cellIndex(tx, ty)) ?? null;
  }

  /** A pulse leaves the game once its front passes its range. */
  get spent(): boolean {
    return this.front > this.range;
  }
}
