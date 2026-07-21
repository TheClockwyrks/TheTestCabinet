// Controls: holding Shift while moving (unladen, charged) multiplies speed by ~1.6x.
// The worker is unladen, so sprint is available; the snapshot's speed and sprinting
// flag are read straight off the real movement step.

import {
  actHoldMeasure,
  setTile,
  startFresh,
  V0,
  SPRINT_MULT,
} from "../_helpers.mjs";

export default function item() {
  // What the measured sprint hold produced, read back by `assert`.
  let r;

  return {
    id: "controls.sprint",

    // Pose the worker unladen (so sprint is unlocked and fully charged) on open ground
    // with room to run right. Control ops only.
    async arrange(api) {
      await startFresh(api, 1);
      await setTile(api, 4, 12);
    },

    // The sprint itself. The snapshot is taken while the keys are still held, so speed
    // and the sprinting flag reflect held motion rather than the moment after release.
    // This IS the clip — the old tail that re-posed and re-held Shift purely for the
    // camera is gone, because the measured run is now what gets filmed.
    //
    // 18 ticks = the old 0.3s hold, and it stays short deliberately: SPRINT_MAX is
    // 1.6s, so a longer hold would drain the bar and drop `sprinting` back to false.
    async act(api) {
      r = await actHoldMeasure(api, ["KeyD", "ShiftLeft"], 18);
    },

    async assert(api, check) {
      check.expectEq(
        "holding Shift while moving sprints",
        r.snap.worker.sprinting,
        true,
      );
      check.expectClose(
        "sprint speed is base x 1.6",
        r.snap.worker.speed,
        V0 * SPRINT_MULT,
        0.5,
      );
      check.expectLt(
        "sprinting drains the sprint charge",
        r.snap.worker.sprintCharge,
        1.6,
      );
    },
  };
}
