// Automated validation for pathing.three-maps: the three maps define different ordered
// waypoint chains at pinned coordinates (chosen, not randomly generated).
//
// Each map is started and its reported waypoint chain read; the three signatures must be
// distinct, and re-starting a map twice must reproduce the same chain (pinned, not random).
//
// The comparison re-starts the run four times, which only `arrange` may do — and a waypoint
// chain is fixed the instant a map opens, so no game time is needed for the verdict. The act
// holds on the last map (Substation, re-opened) long enough to capture the still.

import { startBuild } from "../_helpers.mjs";

// A frame for the still. 100 ms x 60 Hz = 6 ticks exactly.
const SETTLE_TICKS = 6;

function sig(waypoints) {
  return JSON.stringify(waypoints.map((w) => [w.col, w.row]));
}

export default function item() {
  // A signature per map, and the re-read of the first map, both checked by `assert`.
  const sigs = [];
  let again;

  return {
    id: "pathing.three-maps",

    async arrange(api) {
      for (const m of ["substation", "switchyard", "transformer"]) {
        const s = await startBuild(api, { map: m });
        sigs.push(sig(s.waypoints));
      }

      // Pinned, not random: re-starting a map reproduces the same chain.
      again = sig((await startBuild(api, { map: "substation" })).waypoints);
    },

    async act(api) {
      await api.advance(SETTLE_TICKS);
      await api.screenshot("maps");
    },

    async assert(api, check) {
      check.expectEq("the three maps report three distinct waypoint chains", new Set(sigs).size, 3);
      check.expectEq("a map's waypoint chain is fixed (chosen, not random)", again, sigs[0]);
    },
  };
}
