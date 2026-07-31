// Automated validation for controls.combine-c: pressing C folds the current selection — here a
// matching quality pair — immediately.
//
// Placing the pair, naming it as the combine set and selecting the INITIATOR is the arrange;
// the C KEY PRESS is the behavior under test, so it is the act, and the clip shows the fold.
//
// The initiating selection is explicit. `specs/controls.md` binds C to "the current selection"
// and puts the result "at the primary (initiating) piece's footprint" — so which of the pair is
// selected decides where the folded piece lands, which is exactly what this item asserts. The
// script used to leave that to the placement, assuming a drop selects what it dropped; a build
// that does not (nothing requires it — see `controls/keep-k`) had no selection to fold from,
// and one that selects the LAST drop would have folded to the wrong footprint. Selecting (6,7)
// says which one initiates instead of hoping.

import { startBuild, placeCandidate, towerAt, snap, SECOND } from "../_helpers.mjs";

// A fold consumes a fresh candidate, which makes it the level's harvest and launches the wave;
// two seconds is enough to see the folded piece stand and start working.
const CLIP_TICKS = 2 * SECOND;

export default function item() {
  // The board at the instant the C press resolved, read by `assert`.
  let s;

  return {
    id: "controls.combine-c",

    async arrange(api) {
      await startBuild(api);
      const a = await placeCandidate(api, "capacitor", 1, 6, 7);
      const b = await placeCandidate(api, "capacitor", 1, 10, 7);
      await api.call("setCombineSet", [a.id, b.id]); // the pair the C key will fold
      // Put the re-armed rock away and make (6,7) the initiator, so the fold lands there.
      await api.call("rightClick", 640, 400);
      await api.call("select", a.id);
    },

    async act(api) {
      await api.call("press", "KeyC");
      s = await snap(api);

      await api.advance(CLIP_TICKS);
    },

    async assert(api, check) {
      check.expectEq("pressing C combined the matched pair a tier higher", towerAt(s, 6, 7).quality, 2);
      check.expectEq("...at the initiating footprint", towerAt(s, 6, 7).kind, "component");
    },
  };
}
