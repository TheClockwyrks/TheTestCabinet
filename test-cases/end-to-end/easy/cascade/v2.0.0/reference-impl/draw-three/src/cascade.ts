// Cascade — the signature victory animation (specs/cascade.md).
//
// When the game is won, the four completed foundations are launched one card at a
// time on a fixed timestep. Each launched card becomes an independent falling body
// that arcs up, then falls under gravity and bounces off the table floor, losing
// height each bounce, and drifts off one side. Every simulation step each in-flight
// card is painted onto a persistent layer that is never cleared, so the table fills
// with dense arcs of overlapping cards.

import {
  BOUNCE_DAMP,
  CARD_W,
  FIELD_H,
  FIELD_W,
  FLOOR_Y,
  FOUNDATION_X,
  GRAVITY,
  LAUNCH_INTERVAL,
  LAUNCH_VX_MAX,
  LAUNCH_VX_MIN,
  LAUNCH_VY,
  TOP_Y,
} from "./constants";
import type { Rng } from "./deck";
import type { Card } from "./types";

export interface Flyer {
  card: Card;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

// Painted onto a persistent (never-cleared) layer once per simulation step.
export type PaintFn = (card: Card, x: number, y: number) => void;

export class CascadeSim {
  // The four foundations, still complete; each card is launched top-first
  // (King down to Ace) as the foundation is revisited in turn.
  private foundations: Card[][];
  readonly flyers: Flyer[] = [];

  private launchTimer = 0;
  private nextFoundation = 0;
  private launched = 0;
  private readonly total: number;
  done = false;

  private readonly paint: PaintFn;
  // The generator the launch velocities draw from. Seeding it (through the game's
  // reset) makes the whole cascade reproducible (specs/instrumentation.md).
  private readonly rng: Rng;

  constructor(foundations: Card[][], paint: PaintFn, rng: Rng) {
    // Copy so the sim owns its own stacks.
    this.foundations = foundations.map((f) => f.slice());
    this.total = this.foundations.reduce((n, f) => n + f.length, 0);
    this.paint = paint;
    this.rng = rng;
  }

  // The foundation stacks as they empty — drawn beneath the accumulating trail.
  get remaining(): readonly Card[][] {
    return this.foundations;
  }

  // How many cards have launched, and how many launch in all. Read by the debug
  // snapshot and overlay (specs/instrumentation.md).
  get launchedCount(): number {
    return this.launched;
  }

  get totalCount(): number {
    return this.total;
  }

  private launchNext(): void {
    // Cycle the foundations, skipping any already emptied.
    for (let k = 0; k < 4; k++) {
      const idx = (this.nextFoundation + k) % 4;
      const stack = this.foundations[idx];
      if (stack.length > 0) {
        const card = stack.pop()!;
        const sign = this.rng() < 0.5 ? -1 : 1;
        const mag = LAUNCH_VX_MIN + this.rng() * (LAUNCH_VX_MAX - LAUNCH_VX_MIN);
        this.flyers.push({
          card,
          x: FOUNDATION_X[idx],
          y: TOP_Y,
          vx: sign * mag,
          vy: LAUNCH_VY,
        });
        this.nextFoundation = (idx + 1) % 4;
        this.launched++;
        return;
      }
    }
  }

  // Advance the simulation by one fixed step: launch on cadence, integrate every
  // in-flight card, paint it to the trail, bounce it off the floor, and retire it
  // once it clears a side edge.
  step(dt: number): void {
    if (this.done) return;

    this.launchTimer -= dt;
    if (this.launched < this.total && this.launchTimer <= 0) {
      this.launchNext();
      this.launchTimer += LAUNCH_INTERVAL;
    }

    for (let i = this.flyers.length - 1; i >= 0; i--) {
      const f = this.flyers[i];
      // 1. gravity, 2. advance.
      f.vy += GRAVITY * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      // 3. bounce off the floor: reflect and damp vy, reseat on the floor; the
      // horizontal velocity is unchanged (no floor friction).
      if (f.y >= FLOOR_Y && f.vy > 0) {
        f.vy = -f.vy * BOUNCE_DAMP;
        f.y = FLOOR_Y;
      }
      // Paint the card at its current position onto the persistent trail.
      this.paint(f.card, f.x, f.y);
      // Retire once the whole footprint has passed a side edge.
      if (f.x + CARD_W < 0 || f.x > FIELD_W) {
        this.flyers.splice(i, 1);
      }
    }

    if (this.launched >= this.total && this.flyers.length === 0) {
      this.done = true;
    }
  }
}

// Re-export for callers that build the trail viewport.
export const CASCADE_VIEW = { w: FIELD_W, h: FIELD_H } as const;
