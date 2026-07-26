// Automated validation for the Maps sub-item `distribution`.
//
// A round's matter is distributed across the map's paths so every path carries traffic.
// The check starts a real round on the branching map and runs through its spawns,
// gathering which lanes the real wave system releases matter onto — both lanes must
// receive units, so the wave is never funnelled onto one.

import { startRun, MAP } from "../_helpers.mjs";

export default function item() {
  let r;
  // The lanes seen across `act`; a fresh set per pass.
  let seen;

  return {
    id: "maps.distribution",

    async arrange(api) {
      await startRun(api, MAP.branching, { round: 1, integrity: 100000 });
      await api.call("startRound");
      seen = new Set();
    },

    // The wave being released down both lanes — the behavior, and the clip.
    async act(api) {
      // 1200 ticks = the old 20 s cap; poll 15 = the old 0.25 s chunk.
      r = await api.until(
        (s) => {
          for (const u of s.matter) seen.add(u.pathId);
          return seen.has(0) && seen.has(1) && s.matter.length >= 3;
        },
        { max: 1200, poll: 15 },
      );
    },

    async assert(api, check) {
      check.expectOk("lane 0 receives matter during the round", seen.has(0));
      check.expectOk("lane 1 receives matter during the round", seen.has(1));
      check.expectOk(
        "both lanes carry traffic (not funnelled onto one)",
        r.hit,
      );
    },
  };
}
