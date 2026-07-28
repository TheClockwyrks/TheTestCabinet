// Automated validation for the Targeting sub-item `ground-and-air`.
//
// A general emitter (not the air-only Flak) can damage both a ground unit and a flyer
// in range (specs/towers.md). We confirm a plain Arc damages a ground Hulk, then a
// Drift flyer.

import { newGame, restartGame, build, spawn, TICK } from "../_helpers.mjs";

// Pose a hot Arc on the lane with a unit of `surgeType` walking into its range, and
// return that unit's id. `start` is the fresh-match helper to use: `newGame` in
// arrange, and `restartGame` in act — this is a genuine two-configuration comparison
// (ground unit, then flyer), so the second setup lands mid-drive, where `reset()`
// (and therefore `newGame`) throws.
async function poseArcAgainst(api, start, surgeType) {
  await start(api, "containment", "medium", 100000);
  await api.call("setLives", 100000);
  const arc = await build(api, "arc", 10, 17);
  await api.call("setHeat", arc, 80);
  return spawn(api, surgeType, "left");
}

// 480 ticks = the old 8s cap; polling every tick catches the first hit.
const untilDamaged = (api, id) =>
  api.until((s) => s.surge.some((u) => u.id === id && u.hp < u.maxHp), {
    max: 480,
    poll: TICK,
  });

export default function item() {
  let groundId;
  let ground;
  let air;

  return {
    id: "targeting.ground-and-air",

    // Two configurations, each a unit walking or flying into an Arc's range and being
    // hit — a few seconds apiece on a conformant build. The ceiling is what stops a
    // build that routes its Hulk the long way round from turning that into a
    // twenty-second clip. See CLIP_HEADROOM_MS in _helpers.
    clipMs: 6000,

    // Configuration A: a ground Hulk.
    async arrange(api) {
      groundId = await poseArcAgainst(api, newGame, "hulk");
    },

    // Damage the ground unit, then re-pose the same Arc against a flyer and damage
    // that. Both drives are filmed back to back.
    async act(api) {
      ground = await untilDamaged(api, groundId);

      const airId = await poseArcAgainst(api, restartGame, "drift");
      air = await untilDamaged(api, airId);
    },

    async assert(api, check) {
      check.expectOk("the Arc damages a ground unit", ground.hit);
      check.expectOk("the Arc damages an air unit", air.hit);
    },
  };
}
