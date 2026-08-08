// Automated validation for economy.dismantle-no-refund: dismantling a structure returns
// nothing — no Charge and no stamp — so the roll cannot be reclaimed and re-rolled.
//
// A candidate is placed (spending a stamp), then dismantled; Charge and the stamp allowance
// must both be unchanged by the dismantle, and the structure removed.
//
// Placing the candidate is the arrange; the DISMANTLE is the behavior under test and is the act.
//
// WHY THIS IS A CLIP RATHER THAN A STILL. The claim is that two HUD readings do NOT move across
// the dismantle. A still of the aftermath cannot show a value holding — it is one reading, and a
// reviewer has nothing to compare it against — so the evidence has to carry both sides: the
// candidate standing with the HUD as it was, the structure removed, and the same Charge and the
// same spent stamp still on screen afterwards.

import { startBuild, placeCandidate, towerAt, snap, SECOND } from "../_helpers.mjs";

// A beat on the placed candidate before it is removed, and a beat on the board it leaves behind.
const LEAD_TICKS = 1.5 * SECOND;
const TAIL_TICKS = 2 * SECOND;

export default function item() {
  // The candidate to dismantle, and the HUD either side of the dismantle.
  let candId;
  let s1;
  let s2;

  return {
    id: "economy.dismantle-no-refund",

    async arrange(api) {
      await startBuild(api);
      const cand = await placeCandidate(api, "capacitor", 1, 6, 7);
      candId = cand.id;
    },

    async act(api) {
      s1 = await snap(api);
      await api.advance(LEAD_TICKS); // the candidate standing, and the HUD it stands under

      await api.call("dismantle", candId);
      s2 = await snap(api);

      await api.advance(TAIL_TICKS); // the freed footprint, with nothing returned for it
    },

    async assert(api, check) {
      check.expectEq("dismantle returns no Charge", s2.charge, s1.charge);
      check.expectEq("dismantle returns no stamp (the roll is spent for good)", s2.stampsLeft, s1.stampsLeft);
      check.expectEq("the structure was removed", towerAt(s2, 6, 7), null);
    },
  };
}
