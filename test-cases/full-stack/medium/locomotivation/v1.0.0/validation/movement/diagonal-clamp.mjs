// Movement: holding two perpendicular directions moves diagonally at the BASE speed,
// not faster — the diagonal magnitude is clamped to V0 (each axis V0/sqrt2), so there
// is no diagonal speed bonus.

import { actHoldMeasure, setTile, startFresh, V0 } from "../_helpers.mjs";

export default function item() {
  // What the measured diagonal hold produced, read back by `assert`.
  let r;

  return {
    id: "movement.diagonal-clamp",

    // Pose the worker in open yard with room to travel both right and down.
    async arrange(api) {
      await startFresh(api, 1);
      await setTile(api, 8, 10);
    },

    // One second of held diagonal travel. 60 ticks = the old 1.0s exactly, so the
    // measured magnitude is directly comparable against V0.
    async act(api) {
      r = await actHoldMeasure(api, ["KeyD", "KeyS"], 60);
    },

    async assert(api, check) {
      const mag = Math.hypot(r.dx, r.dy);
      check.expectClose(
        "diagonal travel magnitude equals the base speed, not faster",
        mag,
        V0,
        0.6,
      );
      check.expectClose(
        "each axis carries V0/sqrt2",
        r.dx,
        V0 / Math.SQRT2,
        0.6,
      );
      check.expectClose("the diagonal is even (dx == dy)", r.dx, r.dy, 0.01);
    },
  };
}
