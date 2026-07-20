// Automated validation for the Surge sub-item `milestone-core`.
//
// The milestone waves — the midpoint and the finale — each include a Core boss
// (specs/surge.md, waves.md). On Medium the run is 20 waves, so the midpoint is wave
// 10 and the finale wave 20. We jump to each, start it, and confirm a Core spawns.

import { newGame, restartGame } from "../_helpers.mjs";

// Jump to `wave` and release it. `start` is the fresh-match helper to use: `newGame`
// in arrange, and `restartGame` in act — the two milestone waves each need their own
// match, so the second setup lands mid-drive, where `reset()` (and therefore
// `newGame`) throws.
async function poseWave(api, start, wave) {
  await start(api, "containment", "medium", 100000);
  await api.call("setLives", 1000000);
  await api.call("setWave", wave);
  await api.call("startWave");
}

// 840 ticks = the old 14s cap, polled every 15 ticks (the old 0.25s chunk) — long
// enough for a milestone wave to work through to its Core.
const untilCore = (api) =>
  api.until((s) => s.surge.some((u) => u.type === "core"), {
    max: 840,
    poll: 15,
  });

export default function item() {
  let mid;
  let finale;

  return {
    id: "surge.milestone-core",

    // The midpoint wave first.
    async arrange(api) {
      await poseWave(api, newGame, 10);
    },

    // Watch the midpoint wave for its Core, then re-pose at the finale and watch that
    // one. Both drives are filmed back to back.
    async act(api) {
      mid = await untilCore(api);

      await poseWave(api, restartGame, 20);
      finale = await untilCore(api);
    },

    async assert(api, check) {
      check.expectOk("the midpoint wave (10) carries a Core", mid.hit);
      check.expectOk("the final wave (20) carries a Core", finale.hit);
    },
  };
}
