// Automated validation for the Hunter item `continuous`.
//
// The bear moves continuously (pacman-style): each fixed step is a smooth sub-tile
// glide along a single axis — never diagonal, never a whole-tile jump. A bear is
// placed off the critter's column so its route requires turns, then its motion is
// sampled as it glides. See validation/_helpers.mjs.

import { startCrossing, clearIce, TICK, TILE } from "../_helpers.mjs";

// How far (in tiles) a strait-local pixel coordinate sits from the nearest tile
// grid line. Zero means exactly tile-aligned on that axis.
function offTile(px) {
  const t = px / TILE;
  return Math.abs(t - Math.round(t));
}

// How far the bear must actually travel over the sampled span to count as gliding,
// in px. A bear moving at its specified ~3 tiles/second (specs/hunter.md) covers
// about 48 px in the 60 ticks sampled below, so half a tile is a wide margin for a
// build that glides at all — while still failing a bear that only twitches.
//
// The threshold exists because "did it move?" cannot be a single non-zero sample: a
// build whose bear jitters one sub-pixel step and is then dragged back to its tile
// every step (so it never actually travels) produces exactly one moving sample and
// passes a naive check, while sitting frozen for the whole clip. The path length walked,
// accumulated over every tick, is what separates gliding from twitching.
const MIN_PATH_PX = 16;

export default function item() {
  // What the tick-by-tick sweep measured, for `assert` to read.
  let maxOffTile;
  let maxStep;
  let pathLength;

  return {
    id: "hunter.continuous",

    // Pose a clear board so the bear glides plainly toward the critter, with the bear
    // off the critter's column so its route requires turns — which is what makes a
    // diagonal or a teleport visible if the build has one.
    async arrange(api) {
      await startCrossing(api);
      await clearIce(api); // a clear board so the bear glides plainly toward the critter
      await api.call("placeCritter", 20, 10); // median, solid
      await api.call("setBear", 0, { col: 15, row: 16 }); // off-column, so it must turn
    },

    // Sixty single ticks of the real pursuit, sampled one tick at a time — the finest
    // granularity there is, so no glide can hide between reads. Half a second of the
    // bear gliding is also exactly what the clip should show.
    async act(api) {
      let prev = (await api.snapshot()).bears[0];
      maxOffTile = 0; // worst simultaneous off-grid on BOTH axes at once (a diagonal)
      maxStep = 0; // largest jump between reads (a whole-tile teleport)
      pathLength = 0; // total path length walked, not net displacement
      for (let k = 0; k < 60; k += 1) {
        await api.advance(TICK); // one fixed step, the old `FIXED` (1/120 s)
        const b = (await api.snapshot()).bears[0];
        if (!b.present) break;
        // A single-axis glide is always exactly tile-aligned on the axis it is NOT
        // gliding along, so at any instant at most one axis is off the tile grid. This
        // is read from ONE snapshot, so an incidental extra on-screen frame between
        // reads cannot make an axis-aligned mover look diagonal; a genuinely diagonal
        // mover is off-grid on both axes at once.
        maxOffTile = Math.max(maxOffTile, Math.min(offTile(b.x), offTile(b.y)));
        const dx = Math.abs(b.x - prev.x);
        const dy = Math.abs(b.y - prev.y);
        maxStep = Math.max(maxStep, dx, dy);
        // Path length, so a bear that turns a corner still counts every step it took.
        pathLength += Math.hypot(dx, dy);
        prev = b;
      }
    },

    async assert(api, check) {
      check.expectGt("the bear actually glided", pathLength, MIN_PATH_PX);
      check.expectLt(
        "every step moves along a single axis (never diagonal)",
        maxOffTile,
        0.05,
      );
      check.expectLt(
        "every step is a sub-tile glide (never a whole-tile jump)",
        maxStep,
        TILE,
      );
    },
  };
}
