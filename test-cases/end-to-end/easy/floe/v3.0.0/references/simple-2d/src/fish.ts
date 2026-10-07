// Floe — the bonus catch (`specs/bays.md`).
//
// One small fish visits the open bays, at most one on the strait at a time. Its
// whole cadence is one countdown and one draw: `FISH_INTERVAL` from the level being
// laid out (or from the previous one leaving) to the next appearing, then
// `FISH_LINGER` in the bay it appeared in, then it leaves. The bay is drawn
// uniformly among the bays open at that moment other than the one the previous
// catch occupied, and where no such bay exists none appears and the next arrives
// an interval later.
//
// `setFishCadence(false)` gates exactly this — one appearing, lingering and moving
// on — and nothing else. A catch posed through the surface with the cadence off
// therefore stays where it was put, and still scores when its bay is filled.

import { BAY_COUNT, FISH_INTERVAL, FISH_LINGER } from "./constants";
import { nextIndex } from "./rng";
import { expired } from "./timing";
import type { Sim } from "./sim";

/** Put the bonus catch in a bay, its linger clock starting now. */
export function placeFish(sim: Sim, index: number): void {
  sim.fishBay = index;
  sim.fishTimer = FISH_LINGER;
}

/** Take the bonus catch off the strait, and start the wait for the next. */
export function takeFish(sim: Sim): void {
  if (sim.fishBay !== null) sim.lastFishBay = sim.fishBay;
  sim.fishBay = null;
  sim.fishTimer = FISH_INTERVAL;
}

/** No catch out, and the first of the level an interval away. */
export function resetFish(sim: Sim): void {
  sim.fishBay = null;
  sim.lastFishBay = null;
  sim.fishTimer = FISH_INTERVAL;
}

/** The bays a catch may appear in: open, and not the one the last catch held. */
export function eligibleBays(sim: Sim): number[] {
  const bays: number[] = [];
  for (let index = 0; index < BAY_COUNT; index += 1) {
    if (sim.bays[index]) continue;
    if (index === sim.lastFishBay) continue;
    bays.push(index);
  }
  return bays;
}

/** One tick of the bonus catch's own cadence. */
export function stepFish(sim: Sim, dt: number): void {
  if (!sim.gates.fishCadence) return;
  sim.fishTimer = Math.max(0, sim.fishTimer - dt);
  if (!expired(sim.fishTimer)) return;

  if (sim.fishBay !== null) {
    // It has lingered its full time and leaves.
    takeFish(sim);
    return;
  }

  const open = eligibleBays(sim);
  if (open.length === 0) {
    // Nowhere to appear: none appears, and the next arrives an interval later.
    sim.fishTimer = FISH_INTERVAL;
    return;
  }
  placeFish(sim, open[nextIndex(open.length)]);
}
