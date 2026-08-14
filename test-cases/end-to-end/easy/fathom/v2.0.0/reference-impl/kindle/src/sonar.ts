// Fathom — the sonar wavefront. A ping is not an expanding circle: it is a pulse
// that travels OUTWARD through the corridors, bending around bends and reflecting
// off walls, revealing near tiles before far ones (specs/sensing.md). The
// geometry is the corridor flood grouped by distance (Maze.floodBuckets); this
// class turns that static geometry into a moving front that the game reveals and
// hit-tests against, and that render.ts draws as a glowing band.

import { COLS, SONAR_WAVE_BAND, SONAR_WAVE_SPEED } from "./constants";
import type { Cell } from "./maze";
import type { Predator } from "./entities";
import { tileKey } from "./sensing";

export class SonarWave {
  readonly ox: number; // origin (pixels) — the pulse's source, for the core glow
  readonly oy: number;
  readonly violet: boolean; // true = the Gloamfin's ping, false = the forager's
  readonly reveal: boolean; // the forager's ping reveals terrain; the Gloamfin's does not
  orange = false; // true = the guaranteed "lost you" ping — drawn orange, not violet (specs/predators.md)
  readonly buckets: Cell[][]; // corridor tiles indexed by distance from the origin
  readonly dist = new Map<number, number>(); // tileKey -> corridor distance
  // Unit-ish travel direction of the pulse through each tile (the BFS gradient:
  // upstream neighbour → this tile), so render.ts can bulge the wavefront arc the
  // way the sound is actually moving — and swing it round as the pulse turns a
  // corner. The origin has no direction ({0,0}) and draws as a full ring.
  readonly dir = new Map<number, { x: number; y: number }>();
  readonly maxDist: number; // furthest distance the flood reached

  front = 0; // wavefront distance (tiles), advancing at SONAR_WAVE_SPEED
  // The front at the start of the current step, so the renderer can draw the
  // band between the two rather than snapping it forward once per step.
  prevFront = 0;
  surfacedTo = -1; // highest bucket already handed to the caller

  // Bookkeeping so a wave applies each effect exactly once as its front sweeps by.
  emitter: Predator | null = null; // the Gloamfin whose ping this is (violet only)
  playerHit = false; // violet: has the front reached the forager yet?
  readonly hitPreds = new Set<Predator>();

  constructor(
    ox: number,
    oy: number,
    buckets: Cell[][],
    violet: boolean,
    reveal: boolean,
  ) {
    this.ox = ox;
    this.oy = oy;
    this.violet = violet;
    this.reveal = reveal;
    this.buckets = buckets;
    this.maxDist = buckets.length - 1;
    for (let d = 0; d < buckets.length; d++) {
      for (const c of buckets[d]) this.dist.set(tileKey(c.col, c.row), d);
    }
    // Travel direction per tile: average the steps from every upstream neighbour
    // (a tile one corridor-step closer to the origin) into this tile. On a
    // straight run that is the corridor's axis; at a bend it rotates to the new
    // heading — exactly how the wavefront should swing. Wrap-tunnel neighbours are
    // skipped (their offset is not a unit step) so an arc never points off-screen.
    for (const [key, d] of this.dist) {
      if (d === 0) {
        this.dir.set(key, { x: 0, y: 0 });
        continue;
      }
      const col = key % COLS;
      const row = (key - col) / COLS;
      let vx = 0;
      let vy = 0;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nk = (row - dr) * COLS + (col - dc); // the neighbour we'd have come FROM
        if (this.dist.get(nk) === d - 1) {
          vx += dc;
          vy += dr;
        }
      }
      const m = Math.hypot(vx, vy);
      this.dir.set(key, m > 0 ? { x: vx / m, y: vy / m } : { x: 0, y: 0 });
    }
  }

  // Advance the wavefront by dt and return the buckets it newly swept over since
  // the last step, nearest first — so the caller reveals terrain and marks movers
  // exactly as the front reaches them, not all at once.
  advance(dt: number): Cell[][] {
    this.prevFront = this.front;
    this.front += SONAR_WAVE_SPEED * dt;
    const reachTo = Math.min(this.maxDist, Math.floor(this.front));
    const crossed: Cell[][] = [];
    for (let d = this.surfacedTo + 1; d <= reachTo; d++) crossed.push(this.buckets[d]);
    this.surfacedTo = Math.max(this.surfacedTo, reachTo);
    return crossed;
  }

  viewFront(alpha: number): number {
    return this.prevFront + (this.front - this.prevFront) * alpha;
  }

  // Has the wavefront swept past this tile yet? Undefined distance = the pulse
  // never reaches this tile (it is outside the flood), so it is never hit.
  reached(col: number, row: number): boolean {
    const d = this.dist.get(tileKey(col, row));
    return d !== undefined && this.front >= d;
  }

  // Done once the trailing edge of the glowing band has run off the far end.
  get done(): boolean {
    return this.front - SONAR_WAVE_BAND > this.maxDist;
  }
}
