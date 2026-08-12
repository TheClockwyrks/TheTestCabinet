// Automated validation for the Pause sub-item `in-place-interactive`.
//
// While paused in place the board is still interactive — a tower can still be placed on
// the still board. The check starts a live round, pauses in place, and places a tower,
// confirming it succeeds while the paused flag stays set.

import {
  startRun,
  pathGeom,
  placeCovering,
  clipBudget,
  LEAD_TICKS,
  TAIL_TICKS,
  MAP,
} from "../_helpers.mjs";

export default function item() {
  let g;
  let paused;
  let before;
  let after;

  return {
    id: "pause.in-place-interactive",

    clipMs: clipBudget(2 * LEAD_TICKS + TAIL_TICKS),

    async arrange(api) {
      const snap = await startRun(api, MAP.single, {
        round: 1,
        integrity: 100000,
        energy: 100000,
      });
      await api.call("startRound");
      g = pathGeom(snap.paths[0]);
    },

    // The pause and the building that follows it — the behavior under test, and now the
    // whole of the clip. The pause was previously applied in `arrange`, so the recording
    // opened on a board that was already still and the reviewer never saw it stop.
    async act(api) {
      // The round running.
      await api.advance(LEAD_TICKS);

      await api.call("press", "Space"); // pause in place
      paused = await api.snapshot();
      before = paused.towers.length;
      // Held on the frozen board, so what happens next plainly happens while it is frozen.
      await api.advance(LEAD_TICKS);

      const t = await placeCovering(api, "emitter", g, g.length * 0.35);
      after = await api.snapshot();

      // ...and SELECTED, which is the other half of "the board stays fully interactive"
      // (specs/controls.md: "you can keep placing, upgrading, selling, and inspecting
      // towers on the still board"). Selecting draws its range ring and fills the
      // inspector, so the clip shows a tower being built AND inspected under the pause
      // rather than one appearing on a still picture.
      await api.call("selectTower", t.id);
      await api.settle(150);
      await api.advance(TAIL_TICKS);
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
