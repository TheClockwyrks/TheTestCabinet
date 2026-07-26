// Automated validation for foes.glitch-zigzag: the glitch skitters in a restless
// zig-zag (its horizontal direction keeps changing) while descending.
//
// A glitch is spawned and the real updateFoe motion is run forward, sampling its
// POSITION and height: its horizontal direction reverses (it is seen moving both
// left and right) and its vertical position increases over the window.
//
// The zig-zag is read from where the glitch actually IS between samples, not from
// the sign of the reported `vx`. Those are the same fact for a build that reports
// velocity faithfully, but a build can weave by adding an oscillation to its
// per-tick displacement while `vx` holds a constant underlying drift — visibly
// zig-zagging while never reporting a sign change. Reading position tests the
// behavior this item is named for; the separate `vx` assertion below tests the
// snapshot's fidelity, so the two failures stay distinguishable.

import { freshBoard } from "../_helpers.mjs";

const SAMPLES = 40;
const SAMPLE_TICKS = 12; // 12 ticks = the old 0.1s between samples

export default function item() {
  let start;
  let last;
  let sawPos = false;
  let sawNeg = false;
  let vxSawPos = false;
  let vxSawNeg = false;

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
        // Which way it actually moved since the previous sample.
        if (f.x > last.x) sawPos = true;
        if (f.x < last.x) sawNeg = true;
        // And which way it CLAIMS to be moving, checked separately below.
        if (f.vx > 0) vxSawPos = true;
        if (f.vx < 0) vxSawNeg = true;
        last = f;
      }
    },

    async assert(api, check) {
      check.expectOk(
        "the glitch darts both left and right (restless zig-zag)",
        sawPos && sawNeg,
      );
      check.expectGt("the glitch descends over the window", last.y, start.y);
      // The snapshot must report the foe's ACTUAL velocity
      // (specs/instrumentation.md), so a glitch observed reversing must report a
      // `vx` that reverses with it. Scoped to runs where the reversal was actually
      // seen, so this never fires on a window where the glitch simply did not turn.
      check.expectOk(
        "the reported foe vx reverses with the observed zig-zag",
        !(sawPos && sawNeg) || (vxSawPos && vxSawNeg),
      );
    },
  };
}
