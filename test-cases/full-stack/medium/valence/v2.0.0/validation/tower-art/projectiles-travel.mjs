// Automated validation for the Tower Art sub-item `projectiles-travel`.
//
// A shot is a visible projectile that travels across the board over time before it lands,
// rather than an instantaneous hitscan. The check fires a slow Cleaver shot, confirms the
// projectile carries a travel velocity, then advances a little and confirms it moved while
// still in flight.

import {
  startRun,
  pathGeom,
  placeCovering,
  spawnAt,
  TICK,
  MAP,
} from "../_helpers.mjs";

export default function item() {
  let r;
  let p0;
  let before;
  let after;

  return {
    id: "tower-art.projectiles-travel",

    async arrange(api) {
      const snap = await startRun(api, MAP.single);
      const g = pathGeom(snap.paths[0]);
      const s0 = g.length * 0.2;
      await placeCovering(api, "cleaver", g, s0);
      await spawnAt(api, { type: "atom", electrons: 6, pathId: 0, s: s0 + 30 });
    },

    // The shot leaving the tower and crossing the board — the behavior, and the clip.
    async act(api) {
      // 120 ticks = the old 2 s cap. The old poll of 0.02 s is 1.2 ticks, which the
      // contract refuses; it meant "sample as finely as possible", and a projectile can
      // be gone within a few ticks, so one TICK is the right resolution.
      r = await api.until((s) => s.projectiles.length > 0, {
        max: 120,
        poll: TICK,
      });
      p0 = r.snap.projectiles[0];

      before = { x: p0.x, y: p0.y };
      // The old 0.03 s is 1.8 ticks, which the contract refuses. It meant "a couple of
      // steps" — long enough for measurable travel, short enough that the shot has not
      // landed — so 2 ticks is the honest reading of it.
      await api.advance(2);
      after = (await api.snapshot()).projectiles.find((p) => p.id === p0.id);
    },

    async assert(api, check) {
      check.expectOk("a shot is fired", r.hit);
      check.expectGt(
        "the projectile has a travel velocity (not hitscan)",
        Math.hypot(p0.vx, p0.vy),
        1,
      );
      check.expectOk(
        "the projectile is still in flight after a step",
        after != null,
      );
      check.expectGt(
        "the projectile moved across the board",
        Math.hypot(after.x - before.x, after.y - before.y),
        1,
      );
    },
  };
}
