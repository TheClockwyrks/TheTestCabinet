// Fathom — transient visual effects: the expanding sonar rings (the forager's
// cyan ping and the Gloamfin's violet tell) and the detection-alert bursts (the
// bright flash fired when the Gloamfin's ping or the Flarefish's flare acquires
// you — specs/predators.md). The flare bloom is rendered from the Flarefish's own
// flare state (see predators.ts / render.ts); ink clouds are owned by the game.
// These effects are presentation only — the actual reveal is the flooded tile set
// (specs/sensing.md, specs/assets.md).

import { DETECT_FLASH_TIME, SONAR_RING_TIME } from "./constants";

export interface SonarRing {
  x: number;
  y: number;
  t: number; // elapsed
  dur: number;
  range: number; // px the ring grows to
  violet: boolean; // true = Gloamfin's pulse tint, false = forager's cyan
}

// The detection alert: a bright flash burst in a predator's color (specs/predators.md).
export interface Burst {
  x: number;
  y: number;
  t: number; // elapsed
  dur: number;
  color: string; // the acquiring predator's signature color
}

export class Effects {
  rings: SonarRing[] = [];
  bursts: Burst[] = [];

  addRing(x: number, y: number, range: number, violet: boolean): void {
    this.rings.push({ x, y, t: 0, dur: SONAR_RING_TIME, range, violet });
  }

  addBurst(x: number, y: number, color: string): void {
    this.bursts.push({ x, y, t: 0, dur: DETECT_FLASH_TIME, color });
  }

  update(dt: number): void {
    for (const r of this.rings) r.t += dt;
    this.rings = this.rings.filter((r) => r.t < r.dur);
    for (const b of this.bursts) b.t += dt;
    this.bursts = this.bursts.filter((b) => b.t < b.dur);
  }

  clear(): void {
    this.rings.length = 0;
    this.bursts.length = 0;
  }
}
