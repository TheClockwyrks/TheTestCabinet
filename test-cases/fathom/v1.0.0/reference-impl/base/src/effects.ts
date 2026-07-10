// Fathom — transient visual effects: the expanding sonar rings (the forager's
// cyan ping and the Listener's violet tell). The flare bloom is rendered from
// the Flarefish's own flare state (see predators.ts / render.ts); ink clouds are
// owned by the game. These effects are presentation only — the actual reveal is
// the flooded tile set (specs/sensing.md, specs/assets.md).

import { SONAR_RING_TIME } from "./constants";

export interface SonarRing {
  x: number;
  y: number;
  t: number; // elapsed
  dur: number;
  range: number; // px the ring grows to
  violet: boolean; // true = Listener's pulse tint, false = forager's cyan
}

export class Effects {
  rings: SonarRing[] = [];

  addRing(x: number, y: number, range: number, violet: boolean): void {
    this.rings.push({ x, y, t: 0, dur: SONAR_RING_TIME, range, violet });
  }

  update(dt: number): void {
    for (const r of this.rings) r.t += dt;
    this.rings = this.rings.filter((r) => r.t < r.dur);
  }

  clear(): void {
    this.rings.length = 0;
  }
}
