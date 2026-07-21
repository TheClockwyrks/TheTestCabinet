// Automated validation for the Pause sub-item `in-place-interactive`.
//
// While paused in place the board is still interactive — a tower can still be placed on
// the still board. The check starts a live round, pauses in place, and places a tower,
// confirming it succeeds while the paused flag stays set.

import { startRun, pathGeom, placeCovering, MAP } from "../_helpers.mjs";

export default function item() {
  let g;
  let paused;
  let before;
  let after;

  return {
    id: "pause.in-place-interactive",

    async arrange(api) {
      const snap = await startRun(api, MAP.single, {
        round: 1,
        integrity: 100000,
        energy: 100000,
      });
      await api.call("startRound");
      await api.call("press", "Space"); // pause in place
      paused = await api.snapshot();
      before = paused.towers.length;
      g = pathGeom(snap.paths[0]);
    },

    // The placement on the still board — the behavior under test. Placing is a control
    // op, so it is legal here and consumes no simulation time.
    async act(api) {
      await placeCovering(api, "emitter", g, g.length * 0.35);
      after = await api.snapshot();
      await api.settle(150);
    },

    async assert(api, check) {
      check.expectEq("the board is paused in place", paused.paused, true);
      check.expectEq("still paused in place after placing", after.paused, true);
      check.expectEq(
        "a tower can still be placed while paused in place",
        after.towers.length,
        before + 1,
      );
    },
  };
}
