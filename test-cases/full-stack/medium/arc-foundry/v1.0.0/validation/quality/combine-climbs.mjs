// Automated validation for quality.combine-climbs: folding two matching pieces (same type and
// quality) produces one component a tier higher at the initiating piece's footprint, and the
// consumed partner hardens into a blocker.
//
// Placing the matching pair and naming the combine set are control ops (the arrange); the FOLD
// is the behavior under test and is the act. Since the fold consumes a fresh candidate it is
// also the level's harvest, so the clip carries on into the wave and shows the climbed piece
// working.

import { startBuild, placeCandidate, towerAt, snap, SECOND } from "../_helpers.mjs";

const CLIP_TICKS = 2 * SECOND;

export default function item() {
  // The initiator, and the board after the fold.
  let aId;
  let s;

  return {
    id: "quality.combine-climbs",

    async arrange(api) {
      await startBuild(api);
      const a = await placeCandidate(api, "capacitor", 1, 6, 7);
      const b = await placeCandidate(api, "capacitor", 1, 10, 7);
      aId = a.id;
      await api.call("setCombineSet", [a.id, b.id]);
    },

    async act(api) {
      await api.call("combine", aId);
      s = await snap(api);

      await api.advance(CLIP_TICKS);
    },

    async assert(api, check) {
      const at = towerAt(s, 6, 7);
      check.expectEq("the combine produced a component one tier higher", at.quality, 2);
      check.expectEq("...at the initiating piece's footprint", at.kind, "component");
      check.expectEq("...of the same type", at.type, "capacitor");
      check.expectEq("the partner hardened into a blocker", towerAt(s, 10, 7).kind, "blocker");
    },
  };
}
