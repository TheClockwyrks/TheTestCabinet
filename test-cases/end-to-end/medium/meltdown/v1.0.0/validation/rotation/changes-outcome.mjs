// Automated validation for the Rotation sub-item `changes-outcome`.
//
// In the same spot with the same faces blocked, aiming a radiator face at the open
// air cools better than aiming a plain face there — so orientation is a real cooling
// lever (specs/heat.md). We block an Arc's N, S, and W faces with Sinks (equal in
// both cases, so they cancel) and leave the E face on open air; at one rotation a
// radiator face points E, at the other a plain face does. The radiator-facing
// placement must end cooler after the same real cooling step.

import { newGame, restartGame, build, heatOf } from "../_helpers.mjs";

// Pose an Arc at `rot` with N/S/W blocked by Sinks and E on open air, hot at 80, and
// return its id. `start` is the fresh-match helper to use: `newGame` in arrange, and
// `restartGame` in act — this is a genuine two-configuration comparison, so the second
// layout has to be posed mid-drive, where `reset()` (and therefore `newGame`) throws.
async function poseOneOpenFace(api, start, rot) {
  await start(api, "containment", "medium", 100000);
  const id = await build(api, "arc", 12, 12, rot);
  await build(api, "sink", 12, 10); // N
  await build(api, "sink", 12, 14); // S
  await build(api, "sink", 10, 12); // W
  await api.call("setHeat", id, 80);
  return id;
}

// 36 ticks = the old 0.6s cooling step, applied identically to both layouts.
const COOL_TICKS = 36;

export default function item() {
  let aId;
  let radiatorOnOpen;
  let plainOnOpen;

  return {
    id: "rotation.changes-outcome",

    // Configuration A: rot 1, so a radiator face points at the one open (E) face.
    async arrange(api) {
      aId = await poseOneOpenFace(api, newGame, 1);
    },

    // Cool A, then re-pose the same spot at rot 0 (a plain face on the open air) and
    // cool that for exactly as long. Both drives are filmed back to back.
    async act(api) {
      await api.advance(COOL_TICKS);
      radiatorOnOpen = await heatOf(api, aId);

      const b = await poseOneOpenFace(api, restartGame, 0);
      await api.advance(COOL_TICKS);
      plainOnOpen = await heatOf(api, b);
    },

    async assert(api, check) {
      check.expectLt(
        "the same spot cools better with a radiator face on the open air",
        radiatorOnOpen,
        plainOnOpen,
      );
    },
  };
}
