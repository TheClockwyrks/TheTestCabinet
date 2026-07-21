// Movement: an impassable gap blocks the worker rather than letting it walk in, and a
// diagonal into the gap slides the worker along the edge on the free axis. Level 3's gap
// band (cols 12–19) sits directly right of the worker at (11, 8).

import { actHoldMeasure, setTile, startFresh } from "../_helpers.mjs";

const GAP_LEFT_EDGE = 12 * 40; // x = 480, the left edge of the gap band

export default function item() {
  // The two measured holds, read back by `assert`.
  let straight;
  let diag;

  return {
    id: "movement.blocked",

    // Enter level 3, whose gap band is the obstacle under test. The worker is posed in
    // `act` instead of here, because the second scenario has to re-pose it mid-phase
    // anyway and both holds should start from the same place.
    async arrange(api) {
      await startFresh(api, 3);
    },

    // Both scenarios back to back. `setTile` is a control op — it poses position without
    // touching the clock — so it is legal here and is how the second scenario is posed
    // without a `reset` (which would hand the build back its manual clock and freeze the
    // recording). 60 ticks = the old 1.0s hold, in both cases.
    async act(api) {
      // Straight into the gap: the worker is stopped short and never enters a gap tile.
      await setTile(api, 11, 8);
      straight = await actHoldMeasure(api, ["KeyD"], 60);

      // Diagonal into the gap: x is blocked but the worker slides down the free axis.
      await setTile(api, 11, 8);
      diag = await actHoldMeasure(api, ["KeyD", "KeyS"], 60);
    },

    async assert(api, check) {
      check.expectLt(
        "the worker is blocked short of the gap band",
        straight.after.x,
        GAP_LEFT_EDGE,
      );
      check.expectLt(
        "blocked travel is far less than a free second (160 px)",
        straight.dx,
        40,
      );

      check.expectLt(
        "x is still blocked at the gap edge on the diagonal",
        diag.after.x,
        GAP_LEFT_EDGE,
      );
      check.expectGt("the worker slides down the free axis", diag.dy, 60);
    },
  };
}
