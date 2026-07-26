// Automated validation for controls.keep-k: with a candidate selected in the build phase,
// pressing K harvests it — it becomes a firing component and the wave launches.
//
// Placing the candidate (which selects it) is the arrange; the K KEY PRESS is the behavior
// under test, so it is the act — and since the harvest launches the wave, the clip carries on
// into that wave, which is one of the things asserted.

import { startBuild, placeCandidate, towerAt, snap, SECOND } from "../_helpers.mjs";

const CLIP_TICKS = 2 * SECOND;

export default function item() {
  // The board at the instant the K press resolved, read by `assert`.
  let s;

  return {
    id: "controls.keep-k",

    async arrange(api) {
      await startBuild(api);
      await placeCandidate(api, "capacitor", 1, 6, 7); // placing selects it
    },

    async act(api) {
      await api.call("press", "KeyK");
      s = await snap(api);

      await api.advance(CLIP_TICKS);
    },

    async assert(api, check) {
      check.expectEq("pressing K kept the candidate as a firing component", towerAt(s, 6, 7).kind, "component");
      check.expectEq("...and launched the wave", s.phase, "wave");
    },
  };
}
