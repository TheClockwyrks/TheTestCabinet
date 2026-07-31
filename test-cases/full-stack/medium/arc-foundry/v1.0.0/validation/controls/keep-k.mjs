// Automated validation for controls.keep-k: with a candidate selected in the build phase,
// pressing K harvests it — it becomes a firing component and the wave launches.
//
// Placing the candidate and SELECTING it is the arrange; the K KEY PRESS is the behavior under
// test, so it is the act — and since the harvest launches the wave, the clip carries on into
// that wave, which is one of the things asserted.
//
// The selection is explicit. `specs/controls.md` binds K to "a candidate selected during the
// build phase", and `specs/build.md` has the player "select a candidate to inspect ... then
// click KEEP (or press K)" — selecting is its own step. Nothing says a placement selects what
// it just dropped, and continuous placement points the other way: the press re-arms another
// rock on the cursor immediately, and a held rock replaces the inspector entirely
// (`specs/instrumentation.md`, `panelButtons`). This script used to rely on the drop leaving
// its candidate selected, which is one reasonable way to build it and not the only one, so a
// build that leaves the selection alone had nothing for K to act on and failed a binding that
// works.

import { startBuild, placeCandidate, towerAt, snap, SECOND } from "../_helpers.mjs";

const CLIP_TICKS = 2 * SECOND;

export default function item() {
  // The board at the instant the K press resolved, read by `assert`.
  let s;

  return {
    id: "controls.keep-k",

    async arrange(api) {
      await startBuild(api);
      const cand = await placeCandidate(api, "capacitor", 1, 6, 7);
      // Put the re-armed rock away and select the candidate, the way a player reaches for KEEP.
      await api.call("rightClick", 640, 400);
      await api.call("select", cand.id);
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
