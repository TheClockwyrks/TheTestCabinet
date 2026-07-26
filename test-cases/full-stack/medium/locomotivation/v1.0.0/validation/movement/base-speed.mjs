// Movement: unladen, the worker moves at 160 px/s. On the manual clock a one-second
// hold advances the real movement code exactly one second, so the displacement is exact.

import { actHoldMeasure, setTile, startFresh, V0 } from "../_helpers.mjs";

export default function item() {
  // What the measured hold produced, read back by `assert`.
  let r;

  return {
    id: "movement.base-speed",

    // Pose the worker unladen on open ground with a clear run to the right.
    async arrange(api) {
      await startFresh(api, 1);
      await setTile(api, 4, 12);
    },

    // One second of held travel. 60 ticks = the old 1.0s, exactly, which is what makes
    // the displacement comparable against V0 to half a pixel. This IS the clip — a full
    // second of the worker walking is all the reviewer needs, so the old tail that
    // re-posed and re-held the key for the camera is gone.
    async act(api) {
      r = await actHoldMeasure(api, ["KeyD"], 60);
    },

    async assert(api, check) {
      check.expectClose(
        "one second of unladen travel covers 160 px",
        r.dx,
        V0,
        0.5,
      );
      check.expectClose(
        "the reported speed is the base speed",
        r.snap.worker.speed,
        V0,
        0.5,
      );
    },
  };
}
