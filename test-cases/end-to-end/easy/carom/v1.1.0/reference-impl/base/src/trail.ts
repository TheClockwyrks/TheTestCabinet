// Carom — the ball's motion trail.
//
// The trail records ball positions over simulation time. At render, it exposes
// the samples covering the most recent TRAIL_TIME seconds of travel, newest
// first. Because it is a fixed slice of *time*, the resulting polyline length is
// proportional to the ball's current speed — it stretches as the ball speeds up
// and collapses to nothing while the ball is held before a serve. The rendering
// side (render.ts) turns these samples into a single tapering, fading comet.

import { TRAIL_TIME } from "./constants";
import type { TrailSample } from "./types";

const MAX_SAMPLES = 64;

export class Trail {
  private samples: TrailSample[] = [];

  reset(): void {
    this.samples.length = 0;
  }

  record(x: number, y: number, t: number): void {
    this.samples.push({ x, y, t });
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
  }

  // Samples within the trail window, ordered head (newest) -> tail (oldest).
  ribbon(now: number): TrailSample[] {
    const out: TrailSample[] = [];
    for (let i = this.samples.length - 1; i >= 0; i--) {
      const s = this.samples[i];
      if (now - s.t > TRAIL_TIME) break;
      out.push(s);
    }
    return out;
  }
}
