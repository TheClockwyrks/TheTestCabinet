// Automated validation for the Sink sub-item `output-scales`.
//
// A Sink's cooling rises with its level (16/24/36 per edge; specs/heat.md,
// towers.md), so a maxed Sink pulls heat down faster than a level-I one. We cool the
// same hot Arc with a level-I and a level-III Sink (upgraded through the real upgrade
// code) and compare.

import { newGame, restartGame, build, heatOf } from "../_helpers.mjs";

// Pose a hot Arc with a Sink on its south face upgraded to `sinkLevel` through the
// real upgrade code, and return the Arc's id. `start` is the fresh-match helper to
// use: `newGame` in arrange, and `restartGame` in act — this is a genuine
// two-configuration comparison, so the second layout has to be posed mid-drive, where
// `reset()` (and therefore `newGame`) throws.
async function poseWithSink(api, start, sinkLevel) {
  await start(api, "containment", "medium", 100000);
  const arc = await build(api, "arc", 12, 12);
  const sink = await build(api, "sink", 12, 14);
  for (let l = 1; l < sinkLevel; l += 1) await api.call("upgradeTower", sink);
  await api.call("setHeat", arc, 90);
  return arc;
}

// 36 ticks = the old 0.6s cooling step, applied identically to both layouts.
const COOL_TICKS = 36;

export default function item() {
  let aId;
  let l1;
  let l3;

  return {
    id: "sink.output-scales",

    // Configuration A: a level-I Sink.
    async arrange(api) {
      aId = await poseWithSink(api, newGame, 1);
    },

    // Cool A, then re-pose the same layout with a level-III Sink and cool that for
    // exactly as long. Both drives are filmed back to back.
    async act(api) {
      await api.advance(COOL_TICKS);
      l1 = await heatOf(api, aId);

      const b = await poseWithSink(api, restartGame, 3);
      await api.advance(COOL_TICKS);
      l3 = await heatOf(api, b);
    },

    async assert(api, check) {
      check.expectLt(
        "a level-III Sink cools faster than a level-I Sink",
        l3,
        l1,
      );
    },
  };
}
