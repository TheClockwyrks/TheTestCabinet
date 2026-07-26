// Automated validation for build.downgrade-restrictions: only a candidate at Tuned (T2) or
// above can be downgraded; a Scrap (T1) candidate cannot.
//
// A Scrap candidate is placed and a downgrade attempted; it stays a candidate and no wave is
// launched (the control was a no-op).
//
// Opening the run and dropping the Scrap candidate are control ops (the arrange); the refused
// downgrade is the behavior under test and is the act.

import { startBuild, placeCandidate, towerAt, snap } from "../_helpers.mjs";

// A frame for the still, so the capture shows the board the assertions read. 100 ms = 6 ticks.
const SETTLE_TICKS = 6;

export default function item() {
  // The candidate the act tries to downgrade, and the board afterward.
  let candId;
  let s;

  return {
    id: "build.downgrade-restrictions",

    async arrange(api) {
      await startBuild(api);
      const cand = await placeCandidate(api, "capacitor", 1, 6, 7); // Scrap (T1)
      candId = cand.id;
    },

    async act(api) {
      await api.call("downgrade", candId);
      s = await snap(api);

      await api.advance(SETTLE_TICKS);
      await api.screenshot("restrict");
    },

    async assert(api, check) {
      check.expectEq("a Scrap (T1) candidate is not downgraded (still a candidate)", towerAt(s, 6, 7).kind, "candidate");
      check.expectEq("...still at Scrap", towerAt(s, 6, 7).quality, 1);
      check.expectEq("...and no wave was launched", s.phase, "build");
    },
  };
}
