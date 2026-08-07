// Automated validation for the Pause sub-item `in-place-freezes`.
//
// During a live round `Space` pauses IN PLACE — the paused flag is set, the screen stays
// the live board (no menu), and matter, the economy, and any countdown freeze. The check
// starts a live round, presses Space, and confirms nothing advances while paused, then
// resumes and confirms matter moves again.

import {
  startRun,
  pathGeom,
  spawnAt,
  unitById,
  clipBudget,
  LEAD_TICKS,
  TAIL_TICKS,
  MAP,
} from "../_helpers.mjs";

// A freeze is only visible against motion. The clip used to open ON the pause keypress, so
// its first frame was already a still board and there was nothing to tell a frozen game
// apart from a slow one. Running first is what makes the pause read as a pause.
const FROZEN_TICKS = 90;

export default function item() {
  let id;
  let paused;
  let p0;
  let e0;
  let frozen;
  let resumedProgress;

  return {
    id: "pause.in-place-freezes",

    clipMs: clipBudget(LEAD_TICKS + FROZEN_TICKS + TAIL_TICKS),

    async arrange(api) {
      const snap = await startRun(api, MAP.single, {
        round: 1,
        integrity: 100000,
        energy: 100000,
      });
      await api.call("startRound");
      const g = pathGeom(snap.paths[0]);
      id = await spawnAt(api, {
        type: "atom",
        electrons: 4,
        pathId: 0,
        s: g.length * 0.3,
      });
    },

    // The pause, the stillness under it, and the resume — the whole of the behavior, and
    // a clip that reads as a board holding and then moving again.
    async act(api) {
      // The board running: matter travelling, the round live.
      await api.advance(LEAD_TICKS);

      await api.call("press", "Space");
      paused = await api.snapshot();
      p0 = unitById(paused, id).progress;
      e0 = paused.energy;

      // Time does not advance the sim while it is paused — that is exactly what is being
      // checked, and what the reviewer watches for the length of this window.
      await api.advance(FROZEN_TICKS);
      frozen = await api.snapshot();

      // Resume: matter advances again, and is seen to.
      await api.call("press", "Space");
      await api.advance(TAIL_TICKS);
      resumedProgress = unitById(await api.snapshot(), id).progress;
    },

    async assert(api, check) {
      check.expectEq(
        "Space sets the in-place paused flag",
        paused.paused,
        true,
      );
      check.expectEq(
        "the screen stays the live board (no menu)",
        paused.screen,
        "playing",
      );
      check.expectEq(
        "matter is frozen while paused in place",
        unitById(frozen, id).progress,
        p0,
      );
      check.expectEq(
        "the economy is frozen while paused in place",
        frozen.energy,
        e0,
      );
      check.expectGt("resuming lets matter advance again", resumedProgress, p0);
    },
  };
}
