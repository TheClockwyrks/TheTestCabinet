// Automated validation for the Surge sub-item `milestone-core`.
//
// The milestone waves — the midpoint and the finale — each include a Core boss
// (specs/surge.md, waves.md). On Medium the run is 20 waves, so the midpoint is wave
// 10 and the finale wave 20. We jump to each, start it, and confirm a Core spawns.

import { newGame, restartGame, actTail } from "../_helpers.mjs";

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
//
// This is a SKIP, not a filmed sweep. What the item claims is that the milestone wave
// carries a Core; what precedes the Core is the rest of the wave arriving, which is
// neither the claim nor short. Skipping it runs the same real wave and stops on the
// same tick, unfilmed — and each half then films a beat of the Core actually on the
// floor, which is the part worth looking at.
const skipToCore = (api) =>
  api.skipUntil((s) => s.surge.some((u) => u.type === "core"), {
    max: 840,
    poll: 15,
  });

export default function item() {
  let mid;
  let finale;

  return {
    id: "surge.milestone-core",

    // Two skipped waves, each held for a beat once its Core is on the floor.
    clipMs: 5500,

    // The midpoint wave first, run through to its Core unfilmed.
    async arrange(api) {
      await poseWave(api, newGame, 10);
      mid = await skipToCore(api);
    },

    // A beat on the midpoint Core, then the finale wave posed and skipped to its own
    // Core and held the same way. A Core is recognisable by its bulk and its health
    // bar, and neither is legible on the single frame it spawns in.
    async act(api) {
      await actTail(api);

      await poseWave(api, restartGame, 20);
      finale = await skipToCore(api);
      await actTail(api);
    },

    async assert(api, check) {
      check.expectOk("the midpoint wave (10) carries a Core", mid.hit);
      check.expectOk("the final wave (20) carries a Core", finale.hit);
    },
  };
}
