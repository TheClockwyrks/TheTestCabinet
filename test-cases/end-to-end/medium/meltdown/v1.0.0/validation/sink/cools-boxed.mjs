// Automated validation for the Sink sub-item `cools-boxed`.
//
// A Sink cools an emitter through a face that touches it — even a face with no open
// air — so it is the only way to cool a boxed-in tower (specs/heat.md). We box an Arc
// on all four faces (with Forges, which touch but do not conduct or cool) and pose it
// above the Forge setpoint so the Forges add nothing; with no open air it holds its
// heat. Swapping one Forge for a Sink lets it cool through that walled face, so it
// ends cooler.

import { newGame, restartGame, build, heatOf } from "../_helpers.mjs";

// Box an Arc; the east neighbor is a Sink if `sinkEast`, else a Forge. Posed at 80
// heat — above the 72 setpoint, so the Forges are inert and cannot muddy the
// comparison. `start` is the fresh-match helper to use: `newGame` in arrange, and
// `restartGame` in act — this is a genuine two-configuration comparison, so the second
// layout has to be posed mid-drive, where `reset()` (and therefore `newGame`) throws.
async function poseBoxed(api, start, sinkEast) {
  await start(api, "containment", "medium", 100000);
  const arc = await build(api, "arc", 12, 12);
  await build(api, "forge", 12, 10); // N
  await build(api, "forge", 12, 14); // S
  await build(api, "forge", 10, 12); // W
  await build(api, sinkEast ? "sink" : "forge", 14, 12); // E
  await api.call("setHeat", arc, 80);
  return arc;
}

// How long each layout cools for, applied identically to both.
//
// 84 ticks is 1.4 s, up from the 0.4 s this used to run. Four tenths of a second was
// enough to decide the verdict — a Sink pulls 32 per second off an Arc at this heat, so
// the two layouts separate almost at once — and far too short to WATCH. The clip was
// under two seconds for both halves together, which is not long enough to read one heat
// bar falling, let alone to carry its final value across the cut to the second. At 1.4 s
// each the Sink-cooled Arc visibly slides down its bar while the fully-boxed one sits
// exactly where it was posed, and the contrast is the clip rather than an inference from
// it.
const COOL_TICKS = 84;

export default function item() {
  let aId;
  let withSink;
  let allWalled;

  return {
    id: "sink.cools-boxed",

    // Configuration A: boxed, but with a Sink on the east face.
    async arrange(api) {
      aId = await poseBoxed(api, newGame, true);
    },

    // Cool A, then re-pose the same box with a Forge on every face and cool that for
    // exactly as long. Both drives are filmed back to back.
    async act(api) {
      await api.advance(COOL_TICKS);
      withSink = await heatOf(api, aId);

      const b = await poseBoxed(api, restartGame, false);
      await api.advance(COOL_TICKS);
      allWalled = await heatOf(api, b);
    },

    async assert(api, check) {
      check.expectClose(
        "a fully-boxed gun with no Sink barely cools",
        allWalled,
        80,
        1.5,
      );
      check.expectLt(
        "a Sink cools the boxed gun through its walled face",
        withSink,
        allWalled,
      );
    },
  };
}
