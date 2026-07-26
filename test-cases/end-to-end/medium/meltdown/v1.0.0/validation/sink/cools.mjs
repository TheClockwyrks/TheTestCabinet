// Automated validation for the Sink sub-item `cools`.
//
// A Sink touching a hot emitter draws its heat down faster than open air alone
// (specs/heat.md). We cool the same hot Arc with and without a Sink neighbor and
// compare — the Sink version ends cooler.

import { newGame, restartGame, build, heatOf } from "../_helpers.mjs";

// Pose a hot Arc, with a Sink on its south face if `withSink`, and return its id.
// `start` is the fresh-match helper to use: `newGame` in arrange, and `restartGame`
// in act — this is a genuine two-configuration comparison, so the second layout has
// to be posed mid-drive, where `reset()` (and therefore `newGame`) throws.
async function poseArc(api, start, withSink) {
  await start(api, "containment", "medium", 100000);
  const arc = await build(api, "arc", 12, 12);
  if (withSink) await build(api, "sink", 12, 14);
  await api.call("setHeat", arc, 80);
  return arc;
}

// 60 ticks = the old 1s cooling step, applied identically to both layouts.
const COOL_TICKS = 60;

export default function item() {
  let aId;
  let withSink;
  let without;

  return {
    id: "sink.cools",

    // Configuration A: the Arc with a Sink touching it.
    async arrange(api) {
      aId = await poseArc(api, newGame, true);
    },

    // Cool A, then re-pose the same Arc with no Sink and cool that for exactly as
    // long. Both drives are filmed back to back.
    async act(api) {
      await api.advance(COOL_TICKS);
      withSink = await heatOf(api, aId);

      const b = await poseArc(api, restartGame, false);
      await api.advance(COOL_TICKS);
      without = await heatOf(api, b);
    },

    async assert(api, check) {
      check.expectLt(
        "a Sink cools a hot gun faster than open air alone",
        withSink,
        without,
      );
    },
  };
}
