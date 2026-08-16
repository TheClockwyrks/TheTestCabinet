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
//
// WHERE the glitch does all this is checked too, and separately. specs/foes.md has it
// enter from a side edge and roam "across and down into the player band", so a glitch
// that weaves and descends perfectly while never reaching the visible board has not
// implemented this item — and, because it is not on screen, it produces a clip of an
// empty board that says nothing about why. That is a real failure mode: a build whose
// entering foe reverses its velocity at the edge on the same tick it is pushed back
// out will hold it just outside the board indefinitely, moving convincingly the whole
// time. So the position assertions below report how far onto the board the glitch
// actually got, in pixels, rather than leaving a reviewer to infer it from an empty
// recording.

import {
  BOARD_Y,
  foesOf,
  freshBoard,
  STAGE_H,
  STAGE_W,
  TILE,
} from "../_helpers.mjs";

const SAMPLES = 40;
const SAMPLE_TICKS = 12; // 12 ticks = the old 0.1s between samples

/** The glitch, or undefined — read by kind so no other foe can stand in for it. */
function glitch(snap) {
  return foesOf(snap, "glitch")[0];
}

/**
 * How far inside the nearest SIDE edge a foe is, in logical px (negative when it is
 * outside the board entirely).
 *
 * This is the number the arrival assertion reports, because it is the one that
 * separates the two ways an entering glitch can be missing from the board: still on
 * its way in (a small positive value, climbing) and stranded outside it (zero or
 * negative, never climbing). Where a foe's `x, y` sits on its sprite is pinned in
 * specs/overview.md as its centre.
 */
function insideX(f) {
  return Math.min(f.x, STAGE_W - f.x);
}

/** The same, for the board's top and bottom edges (the board is y in [80, 720]). */
function insideY(f) {
  return Math.min(f.y - BOARD_Y, STAGE_H - f.y);
}

/**
 * Whether a foe is CLEARLY on the board, with a whole tile of margin at each side.
 *
 * `spawnFoe` is given no position here, so the build chooses where the glitch enters
 * from — and specs/foes.md only promises that it "enters from a side edge", which
 * means the first thing it does is arrive. The margin is a tile wide so this stays a
 * gate and not a second assertion: it only has to separate "still outside, entering"
 * from "well and truly on the board", and a whole tile of slack means no build is held
 * here over a few pixels of entry animation.
 */
function onBoard(f) {
  return !!f && insideX(f) >= TILE && insideY(f) >= 0;
}

export default function item() {
  let spawned = false;
  let arrived = false;
  let start;
  let last;
  let bestX = -Infinity;
  let bestY = -Infinity;
  let sawPos = false;
  let sawNeg = false;
  let vxSawPos = false;
  let vxSawNeg = false;

  /** Record the furthest onto the board this sighting puts the glitch. */
  function see(f) {
    if (!f) return;
    bestX = Math.max(bestX, insideX(f));
    bestY = Math.max(bestY, insideY(f));
  }

  return {
    id: "foes.glitch-zigzag",

    // Seed 7, as the old script used — the glitch's darting is driven by the real
    // RNG, so the seed is part of the scenario.
    async arrange(api) {
      await freshBoard(api, 7);
      await api.call("spawnFoe", "glitch");
      // Read the spawn straight back, so "no glitch was ever created" and "a glitch
      // was created but never reached the board" stay separable. A snapshot is a pure
      // read and consumes no time, so it is legal here.
      const f = glitch(await api.snapshot());
      spawned = !!f;
      see(f);
    },

    // The sampled window IS the clip: the reviewer watches the very zig-zag the
    // assertions read out of the sampled positions.
    async act(api) {
      // Wait for the entry the spec promises before reading the motion. Capped at 4 s,
      // far longer than a foe crossing the ~1 s of board edge it enters through needs.
      const entry = await api.until(
        (s) => {
          see(glitch(s));
          return onBoard(glitch(s));
        },
        { max: 480, poll: 6 },
      );
      arrived = entry.hit;

      start = glitch(entry.snap);
      last = start;
      for (let i = 0; i < SAMPLES && start; i++) {
        await api.advance(SAMPLE_TICKS);
        const f = glitch(await api.snapshot());
        if (!f) break; // the glitch left the board; keep the last reading
        see(f);
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
      check.expectOk("spawnFoe puts a glitch on the board", spawned);

      // The two ways a glitch can fail to be where this item watches, each reporting
      // the distance that says which one happened. A glitch held outside the side edge
      // reads as a negative or near-zero `bestX`; one that spawned or fell outside the
      // board vertically reads the same on `bestY`.
      check.expectGe(
        "the glitch reaches the visible board (px inside the nearest side edge)",
        bestX,
        TILE,
      );
      check.expectGe(
        "the glitch is within the board vertically (px inside the nearest top/bottom edge)",
        bestY,
        0,
      );
      check.expectOk(
        "the glitch is on screen while it skitters, not roaming outside the board",
        arrived,
      );

      check.expectOk(
        "the glitch darts both left and right (restless zig-zag)",
        sawPos && sawNeg,
      );
      // `?? 0` so a glitch that never appeared at all reads as "did not descend"
      // rather than throwing and burying the failures above in a stack trace.
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
