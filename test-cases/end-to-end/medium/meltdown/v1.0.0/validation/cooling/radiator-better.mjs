// Automated validation for the Surface-cooling sub-item `radiator-better`.
//
// The radiator faces shed heat far better than plain faces (specs/heat.md). With an
// Arc's east and west faces blocked (by Sinks, which cool both cases equally so they
// cancel out of the comparison), the only difference is which faces point at the
// open N/S air: at rotation 0 the Arc's radiator faces do, at rotation 1 its plain
// faces do. The radiator-facing placement must end cooler after the same real
// cooling step.

import { newGame, restartGame, build, heatOf } from "../_helpers.mjs";

// Pose an Arc at `rot` with Sinks blocking its E and W faces, hot at 80, and return
// its id. `start` is the fresh-match helper to use: `newGame` in arrange, and
// `restartGame` in act — this is a genuine two-configuration comparison, so the
// second layout has to be posed mid-drive, where `reset()` (and therefore `newGame`)
// throws.
async function poseBlocked(api, start, rot) {
  await start(api, "containment", "medium", 100000);
  const id = await build(api, "arc", 12, 12, rot);
  await build(api, "sink", 10, 12); // W
  await build(api, "sink", 14, 12); // E
  await api.call("setHeat", id, 80);
  return id;
}

// 30 ticks = the old 0.5s cooling step, applied identically to both layouts.
const COOL_TICKS = 30;

export default function item() {
  let aId;
  let radOpen;
  let plainOpen;

  return {
    id: "cooling.radiator-better",

    // Configuration A: rotation 0, so the Arc's radiator faces point at the open N/S
    // air.
    async arrange(api) {
      aId = await poseBlocked(api, newGame, 0);
    },

    // Cool A, then re-pose the same spot at rotation 1 (plain faces on the open air)
    // and cool that for exactly as long. Both drives are filmed back to back.
    async act(api) {
      await api.advance(COOL_TICKS);
      radOpen = await heatOf(api, aId);

      const b = await poseBlocked(api, restartGame, 1);
      await api.advance(COOL_TICKS);
      plainOpen = await heatOf(api, b);
    },

    async assert(api, check) {
      check.expectLt(
        "radiator faces on open air cool faster than plain faces",
        radOpen,
        plainOpen,
      );
    },
  };
}
