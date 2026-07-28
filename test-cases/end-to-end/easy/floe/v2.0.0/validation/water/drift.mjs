// Automated validation for the Water band item `drift`.
//
// Each water lane's floes drift along the lane by its own direction and speed as
// the simulation advances. For each lane one floe is tracked across a real step and
// its displacement compared to dir*speed*TILE*dt. See validation/_helpers.mjs.
//
// THE SNAPSHOT'S `items` ARRAY CARRIES NO IDENTITY, so the tracked floe is matched
// by POSITION rather than by index. specs/instrumentation.md defines a lane's
// `items` as the floes with their strait-local `x`; it promises nothing about the
// order they arrive in, and nothing about an entry meaning the same floe from one
// snapshot to the next. Two conformant builds already break that assumption in
// different ways: one reports only the floes actually on the strait, so the array
// shifts by one whenever a floe leaves the left edge or a new one enters at the
// right; another reports the whole track including the floes off either end, so an
// entry jumps the length of the track when it respawns at the far edge. Matching by
// index then reads one floe's position against a DIFFERENT floe's and reports a
// displacement out by roughly the lane's floe spacing — a fabricated failure
// against a build whose floes drift perfectly.
//
// So the tracked floe is the one nearest the MIDDLE of the strait — far from either
// edge, so it is reported by either kind of build both before and after, and is
// never the one that wraps — and afterwards it is re-identified as the floe nearest
// where it was. A lane drifts as one rigid train, so that match is exact as long as
// the drift stays under half the floe spacing, which is what sizes the span below.

import { startCrossing, TICK_HZ, TILE, STRAIT_W } from "../_helpers.mjs";

// The measured span. `advance` counts TICKS, but a lane's `speed` is in tiles per
// SECOND, so the expected displacement needs the same span in seconds: 30 ticks at
// 120 Hz is exactly 0.25 s, so both forms are exact and the comparison stays tight.
//
// A quarter-second is also what keeps the position match unambiguous. The tightest
// floe spacing in specs/water.md is a pan lane's 1-tile floe plus its 2-tile gap —
// 3 tiles, 96 px — and the fastest lane runs at 4.2 tiles/s, so a quarter-second
// carries a floe at most 33.6 px: comfortably inside the 48 px half-spacing beyond
// which a floe's nearest neighbour after the step could be a neighbouring floe
// rather than itself. (The old span was twice this, which the fast lanes overshot.)
const DT_TICKS = 30;
const DT = DT_TICKS / TICK_HZ; // 0.25 s

// How long the clip keeps filming the band drift after the measurement. A
// quarter-second of footage shows a reviewer nothing, and the measured span is
// deliberately short; the simulation either side of the read is the same one, so
// the tail costs the verdict nothing and gives the clip its whole point.
const TAIL_TICKS = 240; // 2 s

/** The strait-local center of a lane item, in px. */
function itemCenter(item) {
  return item.x + (item.len * TILE) / 2;
}

/** The index of the item whose center is nearest strait-local `x`. */
function nearestIndex(items, x) {
  let idx = 0;
  for (let k = 1; k < items.length; k += 1) {
    if (
      Math.abs(itemCenter(items[k]) - x) < Math.abs(itemCenter(items[idx]) - x)
    )
      idx = k;
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
    },

    // The validate pass advances the sim by exactly this much (no stray wall-clock
    // frames), so the drift equals dir*speed*TILE*dt to within float rounding. The
    // clip then keeps rolling on the drifting band for a couple of seconds.
    //
    // BOTH ends of the measured span are read here, in `act`, rather than opening it
    // back in `arrange`. The runtime only settles the build onto its manual clock
    // BETWEEN the two phases, so a span that starts in `arrange` also contains
    // however much wall-clock time the driver's own round trips happened to take —
    // which is not a fixed number of ticks, and lands the comparison a tick or two
    // off a tolerance this tight at random. Reading `before` here makes the span
    // exactly the `advance` below, and the check deterministic.
    async act(api) {
      before = (await api.snapshot()).lanes.water;
      await api.advance(DT_TICKS);
      after = (await api.snapshot()).lanes.water;
      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      for (let i = 0; i < before.length; i += 1) {
        const expected = before[i].dir * before[i].speed * TILE * DT;
        // The floe nearest mid-strait before the step, found again afterwards as the
        // floe nearest where it was. A lane with nothing in it cannot be measured at
        // all — that a lane carries floes is `water.lanes`' item, so record the gap
        // here rather than reading a displacement off a floe that is not there.
        const started = before[i].items;
        const ended = after[i].items;
        if (started.length === 0 || ended.length === 0) {
          check.expectOk(`water lane ${i} carries a floe to track`, false);
          continue;
        }
        const tracked = started[nearestIndex(started, STRAIT_W / 2)];
        const matched = ended[nearestIndex(ended, itemCenter(tracked))];
        check.expectClose(
          `water lane ${i} drifts by dir*speed*dt`,
          itemCenter(matched) - itemCenter(tracked),
          expected,
          1e-3,
        );
      }
    },
  };
}
