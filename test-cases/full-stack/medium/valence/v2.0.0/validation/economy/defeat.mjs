// Automated validation for the Economy sub-item `defeat`.
//
// Reaching zero integrity loses the game — the containment-failed (defeat) screen
// appears, even mid-round. The check sets integrity to 1, poses a unit near the
// collector whose leak cost exceeds it, and runs on until the defeat screen resolves
// through the real containment check.

import { startScenario, pathGeom, spawnAt, MAP } from "../_helpers.mjs";

export default function item() {
  let r;

  return {
    id: "economy.defeat",

    async arrange(api) {
      const snap = await startScenario(api, MAP.single, { integrity: 1 });
      const g = pathGeom(snap.paths[0]);
      await spawnAt(api, {
        type: "atom",
        electrons: 3,
        pathId: 0,
        s: g.length - 20,
      });
    },

    // The unit reaching the collector and the run being lost for it.
    async act(api) {
      // 240 ticks = the old 4 s cap; poll 3 = the old 0.05 s chunk.
      r = await api.until((s) => s.screen === "defeat", { max: 240, poll: 3 });
      // A real pause so the defeat screen has actually PAINTED before it is captured.
      await api.settle(200);
      await api.screenshot("defeat");
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
