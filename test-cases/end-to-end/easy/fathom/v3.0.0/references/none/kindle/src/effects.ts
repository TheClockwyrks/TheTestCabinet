// Fathom — the detection-alert flashes.
//
// The alert a Gloamfin or a Flarefish fires the instant it takes a fix is drawn
// in code as a sharp burst in that hunter's own color, snapping outward and
// fading over the alert window (`specs/predators.md`). The window itself is
// carried by the predator, so what lives here is presentation alone.

import { ALERT_TIME } from "./constants";
import type { PredatorKind } from "./types";

export interface Burst {
  x: number;
  y: number;
  /** Which hunter fired it, which fixes the color it is drawn in. */
  kind: PredatorKind;
  /** Seconds it has been playing, against `ALERT_TIME`. */
  elapsed: number;
}

export class Effects {
  private bursts: Burst[] = [];

  get all(): readonly Burst[] {
    return this.bursts;
  }

  add(x: number, y: number, kind: PredatorKind): void {
    this.bursts.push({ x, y, kind, elapsed: 0 });
  }

  update(dt: number): void {
    for (const burst of this.bursts) burst.elapsed += dt;
    this.bursts = this.bursts.filter((burst) => burst.elapsed < ALERT_TIME);
  }

  clear(): void {
    this.bursts = [];
  }
}
