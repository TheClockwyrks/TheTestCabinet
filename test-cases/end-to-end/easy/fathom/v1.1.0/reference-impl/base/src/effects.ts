// Fathom — transient visual effects: the detection-alert bursts (the bright flash
// fired when the Gloamfin's ping or the Flarefish's flare acquires you —
// specs/predators.md). The traveling sonar wavefront lives in sonar.ts (it is
// simulation, not just presentation); the flare bloom is rendered from the
// Flarefish's own flare state (see predators.ts / render.ts); ink clouds are owned
// by the game. These effects are presentation only.

import { DETECT_FLASH_TIME } from "./constants";

// The detection alert: a bright flash burst in a predator's color (specs/predators.md).
export interface Burst {
  x: number;
  y: number;
  t: number; // elapsed
  dur: number;
  color: string; // the acquiring predator's signature color
}

export class Effects {
  bursts: Burst[] = [];

  addBurst(x: number, y: number, color: string): void {
    this.bursts.push({ x, y, t: 0, dur: DETECT_FLASH_TIME, color });
  }

  update(dt: number): void {
    for (const b of this.bursts) b.t += dt;
    this.bursts = this.bursts.filter((b) => b.t < b.dur);
  }

  clear(): void {
    this.bursts.length = 0;
  }
}
