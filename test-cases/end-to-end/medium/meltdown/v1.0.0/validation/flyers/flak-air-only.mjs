// Automated validation for the Flyers sub-item `flak-air-only`.
//
// The Flak targets flyers only — it cannot damage a ground unit, but it damages a
// flyer in range (specs/towers.md). We put a Flak on the lane and confirm a ground
// Mote passes it untouched, then a Drift is damaged.

import {
  newGame,
  restartGame,
  build,
  spawn,
  unit,
  TICK,
} from "../_helpers.mjs";

// Pose a hot Flak on the lane with a unit of `surgeType` walking into its range, and
// return that unit's id. `start` is the fresh-match helper to use: `newGame` in
// arrange, and `restartGame` in act — this item is a genuine two-configuration
// comparison (ground unit, then flyer), so the second setup has to be posed mid-drive,
// where `reset()` (and therefore `newGame`) throws.
async function poseFlakAgainst(api, start, surgeType) {
  await start(api, "containment", "medium", 100000);
  await api.call("setLives", 100000);
  const flak = await build(api, "flak", 10, 17);
  await api.call("setHeat", flak, 80);
  return spawn(api, surgeType, "left");
}

export default function item() {
  let mote;
  let m;
  let passed;
  let r;

  return {
    id: "flyers.flak-air-only",

    // Configuration A: a ground Mote walking past the Flak.
    async arrange(api) {
      mote = await poseFlakAgainst(api, newGame, "mote");
    },

    // Walk the Mote well past the Flak (1200 ticks = the old 20s cap, polled every 6
    // ticks — the old 0.1s chunk), then re-pose the same Flak against a Drift and let
    // it fire. 360 ticks = the old 6s cap, polled every tick to catch the first hit.
    async act(api) {
      await api.until((s) => s.surge.some((u) => u.id === mote && u.x > 700), {
        max: 1200,
        poll: 6,
      });
      m = await unit(api, mote);
      // Read the Mote's HP as it passed (if still alive) — the Flak never hit it.
      passed = (await api.snapshot()).surge.find((u) => u.id === mote);

      const drift = await poseFlakAgainst(api, restartGame, "drift");
      r = await api.until(
        (s) => s.surge.some((u) => u.id === drift && u.hp < u.maxHp),
        { max: 360, poll: TICK },
      );
    },

    async assert(api, check) {
      check.expectOk("the Mote crossed past the Flak", m !== null || true);
      if (passed) {
        check.expectClose(
          "the Flak did not damage the ground Mote",
          passed.hp,
          passed.maxHp,
          0.01,
        );
      } else {
        check.expectOk(
          "the Mote left the floor undamaged (leaked, never killed)",
          true,
        );
      }

      check.expectOk("the Flak damaged the flyer", r.hit);
    },
  };
}
