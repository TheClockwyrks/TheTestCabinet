// Automated validation for materials.scanner-hidden.
//
// When no needed material is within scanner range there is no lock and no idle indicator. On the
// surface with a scanner fitted, both buried nodes are hundreds of rows below range, so the scanner
// shows no lock.

import { newRun } from "../_helpers.mjs";

export default function item() {
  let s;

  return {
    id: "materials.scanner-hidden",

    // A scanner fitted on the surface, with both buried nodes far below its range.
    async arrange(api) {
      await newRun(api); // miner on the surface, both nodes far below
      await api.call("grantGear", { scanner: 2 }); // the first scanner level (range 10) — still far short
      s = (await api.snapshot()).scanner;
    },

    // Nothing to drive — the absence of an indicator is the behavior. A beat of live play so the
    // clip shows the uncluttered HUD staying that way. 42 ticks = 0.7 s, the old 700 ms tail.
    async act(api) {
      await api.advance(42);
    },

    async assert(api, check) {
      check.expectEq("no lock when nothing is in range", s.locked, false);
    },
  };
}
