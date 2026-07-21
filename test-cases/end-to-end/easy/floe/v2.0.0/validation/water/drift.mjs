// Automated validation for the Water band item `drift`.
//
// Each water lane's floes drift along the lane by its own direction and speed as
// the simulation advances. For each lane one item is tracked across a real step
// and its displacement compared to dir*speed*TILE*dt. Items wrap seamlessly
// within the lane's track, so the tracked item is chosen NOT to cross the wrap
// boundary during the (tiny) step — the bottom-most item when the lane drifts
// toward higher x, the top-most when it drifts toward lower x — matched by index,
// since a step advances a lane's items in place without reordering them. See
// validation/_helpers.mjs.

import { startCrossing, TICK_HZ, TILE } from "../_helpers.mjs";

// The measured span. `advance` counts TICKS, but a lane's `speed` is in tiles per
// SECOND, so the expected displacement needs the same span in seconds: 60 ticks at
// 120 Hz is exactly 0.5 s, so both forms are exact and the comparison stays tight.
const DT_TICKS = 60;
const DT = DT_TICKS / TICK_HZ; // 0.5 s

// The index of a lane item that will not cross the wrap boundary over a small
// forward step: moving toward higher x (dir >= 0) the max-x item can wrap, so
// track the min-x one; moving toward lower x the min-x item can wrap, so track
// the max-x one.
function safeItemIndex(items, dir) {
  let idx = 0;
  for (let k = 1; k < items.length; k += 1) {
    const nearerBoundary =
      dir >= 0 ? items[k].x < items[idx].x : items[k].x > items[idx].x;
    if (nearerBoundary) idx = k;
  }
  return idx;
}

export default function item() {
  // The lanes either side of the measured span.
  let before;
  let after;

  return {
    id: "water.drift",

    async arrange(api) {
      await startCrossing(api);
      before = (await api.snapshot()).lanes.water;
    },

    // The validate pass advances the sim by exactly this much (no stray wall-clock
    // frames), so the drift equals dir*speed*TILE*dt to within float rounding. Half a
    // second of floes drifting along the lanes is also the clip.
    async act(api) {
      await api.advance(DT_TICKS);
      after = (await api.snapshot()).lanes.water;
    },

    async assert(api, check) {
      for (let i = 0; i < before.length; i += 1) {
        const expected = before[i].dir * before[i].speed * TILE * DT;
        const idx = safeItemIndex(before[i].items, before[i].dir);
        const dx = after[i].items[idx].x - before[i].items[idx].x;
        check.expectClose(
          `water lane ${i} drifts by dir*speed*dt`,
          dx,
          expected,
          1e-3,
        );
      }
    },
  };
}
