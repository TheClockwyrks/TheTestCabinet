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

import { freshBoard, STAGE_W, TILE } from "../_helpers.mjs";

const SAMPLES = 40;
const SAMPLE_TICKS = 12; // 12 ticks = the old 0.1s between samples

/**
 * Whether a foe is CLEARLY on the board, with a whole tile of margin at each side.
 *
 * `spawnFoe` is given no position here, so the build chooses where the glitch
 * enters from — and specs/foes.md only promises that it "enters from a side edge",
 * which means the first thing it does is arrive. Sampling before it has is
 * measuring whatever it does outside the board, which is not the roaming zig-zag
 * this item is named for.
 *
 * The margin is a tile wide so this gate stays a gate and not a second assertion:
 * it only has to separate "still outside, entering" from "well and truly on the
 * board", and a whole tile of slack means no build is held here over a few pixels
 * of entry animation. Where a foe's `x, y` sits on its sprite is pinned in
 * specs/overview.md; nothing about this margin depends on reading it closely.
 */
function onBoard(f) {
  return !!f && f.x >= TILE && f.x <= STAGE_W - 2 * TILE;
}

export default function item() {
  let arrived;
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
      // Wait for the entry the spec promises before reading anything. Capped at 4 s,
      // far longer than a foe crossing the ~1 s of board edge it enters through
      // needs; a glitch that never arrives fails the first assertion below and says
      // so, instead of leaving the motion assertions to describe off-board drift.
      const entry = await api.until((s) => onBoard(s.foes[0]), {
        max: 480,
        poll: 6,
      });
      arrived = entry.hit;

      start = entry.snap.foes[0];
      last = start;
      for (let i = 0; i < SAMPLES && start; i++) {
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
      check.expectOk("the glitch enters the board (specs/foes.md)", arrived);
      check.expectOk(
        "the glitch darts both left and right (restless zig-zag)",
        sawPos && sawNeg,
      );
      // `?? 0` so a glitch that never appeared at all reads as "did not descend"
      // rather than throwing and burying the arrival failure above in a stack trace.
      check.expectGt(
        "the glitch descends over the window",
        last?.y ?? 0,
        start?.y ?? 0,
      );
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
