// Cascade — one frame.
//
// Every pointer sample the frame delivered is answered on its own and in the
// order it arrived (`specs/controls.md`), so a press and the release that
// followed it inside one frame both take effect and a gesture is never reduced to
// the last position of the frame that carried it. Then the clock advances and the
// victory cascade takes its step.

import { stepCascade } from "./cascade";
import { moveTo, pressAt, releaseAt } from "./pointer";
import type { Sim } from "./sim";

/** One pointer sample, as the engine reports it. */
export interface PointerSampleLike {
  readonly type: "down" | "move" | "up";
  readonly x: number;
  readonly y: number;
}

/** Advance `sim` by one frame of `dt` seconds, answering `samples` first. */
export function stepFrame(
  sim: Sim,
  samples: readonly PointerSampleLike[],
  dt: number,
): void {
  for (const sample of samples) {
    switch (sample.type) {
      case "down":
        pressAt(sim, sample.x, sample.y);
        break;
      case "move":
        moveTo(sim, sample.x, sample.y);
        break;
      case "up":
        releaseAt(sim, sample.x, sample.y);
        break;
    }
  }

  sim.simTime += dt;
  stepCascade(sim, dt);
}
