// Automated validation for the Economy sub-item `defeat`.
//
// Reaching zero integrity loses the game — the containment-failed (defeat) screen
// appears, even mid-round. The check sets integrity to 1, poses a unit near the
// collector whose leak cost exceeds it, and runs on until the defeat screen resolves
// through the real containment check.

import {
  startScenario,
  pathGeom,
  spawnAt,
  clipBudget,
  LEAD_TICKS,
  TAIL_TICKS,
  MAP,
} from "../_helpers.mjs";

// Posed a readable distance short of the collector rather than 20px. Losing the run is a
// TRANSITION — a live board, a leak, integrity crossing zero, the containment-failed screen
// — and a still of the end screen shows only the last of those. From here the reviewer
// watches the unit come in with 1 integrity on the clock.
const APPROACH_PX = 170;
const MAX_DEFEAT_TICKS = 420; // 7 s — generous for the slowest atom over APPROACH_PX

export default function item() {
  let r;

  return {
    id: "economy.defeat",

    clipMs: clipBudget(LEAD_TICKS + MAX_DEFEAT_TICKS + TAIL_TICKS),

    async arrange(api) {
      const snap = await startScenario(api, MAP.single, { integrity: 1 });
      const g = pathGeom(snap.paths[0]);
      await spawnAt(api, {
        type: "atom",
        electrons: 3,
        pathId: 0,
        s: g.length - APPROACH_PX,
      });
    },

    // The unit reaching the collector and the run being lost for it.
    async act(api) {
      // The board as posed: one atom on the conduit and 1 integrity left to lose.
      await api.advance(LEAD_TICKS);
      // poll 3 = the old 0.05 s chunk.
      r = await api.until((s) => s.screen === "defeat", {
        max: MAX_DEFEAT_TICKS,
        poll: 3,
      });
      // Held on the containment-failed screen, so it is legibly ON the recording rather
      // than the frame it cut at.
      await api.settle(200);
      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectOk("reaching zero integrity ends the game", r.hit);
      check.expectEq(
        "the game is lost (defeat screen)",
        r.snap.screen,
        "defeat",
      );
    },
  };
}
