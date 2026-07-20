// Automated validation for foes.glitch-zigzag: the glitch skitters in a restless
// zig-zag (its horizontal direction keeps changing) while descending.
//
// A glitch is spawned and the real updateFoe motion is run forward, sampling its
// velocity and height: its horizontal direction reverses (both signs are seen) and
// its vertical position increases over the window.

import { freshBoard } from "../_helpers.mjs";

const SAMPLES = 40;
const SAMPLE_TICKS = 12; // 12 ticks = the old 0.1s between samples

export default function item() {
  let start;
  let last;
  let sawPos = false;
  let sawNeg = false;

  return {
    id: "foes.glitch-zigzag",

    // Seed 7, as the old script used — the glitch's darting is driven by the real
    // RNG, so the seed is part of the scenario.
    async arrange(api) {
      await freshBoard(api, 7);
      await api.call("spawnFoe", "glitch");
    },

    // The sampled window IS the clip: the reviewer watches the very zig-zag the
    // assertions read out of the velocity signs.
    async act(api) {
      start = (await api.snapshot()).foes[0];
      last = start;
      for (let i = 0; i < SAMPLES; i++) {
        await api.advance(SAMPLE_TICKS);
        const f = (await api.snapshot()).foes[0];
        if (!f) break; // the glitch left the board; keep the last reading
        if (f.vx > 0) sawPos = true;
        if (f.vx < 0) sawNeg = true;
        last = f;
      }
    },

    async assert(api, check) {
      check.expectOk(
        "the glitch darts both left and right (restless zig-zag)",
        sawPos && sawNeg,
      );
      check.expectGt("the glitch descends over the window", last.y, start.y);
    },
  };
}
