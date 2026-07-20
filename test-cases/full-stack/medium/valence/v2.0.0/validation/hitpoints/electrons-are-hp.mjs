// Automated validation for the Hit Points sub-item `electrons-are-hp`.
//
// An atom's electron count is its hit points, so a bigger atom takes more hits to
// neutralize. The check times how long an identical Emitter takes to neutralize a
// 1-electron atom versus a 6-electron atom and confirms the larger one takes longer.
// Each atom is posed at the upstream edge of the tower's range (coverAndPassThrough) so
// it travels the tower's full in-range window — the dwell a 6-electron atom needs to be
// worn all the way down by one tower.
//
// TWO runs: the small atom is arranged, the large one posed inside `act` with
// `poseCoverAndPassThrough` (no `reset`, which would freeze the recording). The old
// script re-posed a THIRD scenario purely to film a 6-electron atom being stripped; that
// is what `act` now ends on, so the extra run is gone.

import {
  coverAndPassThrough,
  poseCoverAndPassThrough,
  unitById,
} from "../_helpers.mjs";

/** Run a posed atom down and report the sim time at which it was neutralized. */
async function actTimeToKill(api, unitId) {
  // 720 ticks = the old 12 s cap; poll 3 = the old 0.05 s chunk.
  const r = await api.until((s) => unitById(s, unitId) == null, {
    max: 720,
    poll: 3,
  });
  return { t: r.snap.simTime, hit: r.hit };
}

export default function item() {
  let smallId;
  let small;
  let big;

  return {
    id: "hitpoints.electrons-are-hp",

    async arrange(api) {
      ({ unitId: smallId } = await coverAndPassThrough(api, {
        kind: "ionizer",
        type: "atom",
        electrons: 1,
      }));
    },

    // The 1-electron atom going down almost at once, then the 6-electron atom taking the
    // tower's whole window — the contrast the item is about.
    async act(api) {
      small = await actTimeToKill(api, smallId);

      const { unitId: bigId } = await poseCoverAndPassThrough(api, {
        kind: "ionizer",
        type: "atom",
        electrons: 6,
      });
      big = await actTimeToKill(api, bigId);
    },

    async assert(api, check) {
      check.expectOk("the small atom was neutralized", small.hit);
      check.expectOk("the large atom was neutralized", big.hit);
      check.expectGt(
        "a 6-electron atom takes longer to neutralize than a 1-electron one",
        big.t,
        small.t,
      );
    },
  };
}
