// Automated validation for economy.placement-free: placing a rock costs no Charge (the
// five-per-level stamp allowance is the only placement limit).
//
// Charge is read before and after a placement; it must be unchanged, while the stamp
// allowance decrements by one.
//
// Only opening the run is arranged; the PLACEMENT is the behavior under test, and a placement
// is a control op, so it is the act and is what the clip shows.
//
// WHY THIS IS A CLIP RATHER THAN A STILL. The claim is that two HUD readings do not move across
// an event: Charge is the same afterwards as it was before, while the stamp allowance is not. A
// still can only show one of those readings, so it cannot show a value HOLDING — a picture of
// "CHARGE 10" after a placement is equally consistent with a build that charged for the rock and
// with one that did not, unless the reviewer already knows what it read a moment earlier. A clip
// that opens on the HUD, drops the rock, and holds on the HUD afterwards shows the comparison
// the item is actually making.

import { startBuild, placeCandidate, snap, SECOND } from "../_helpers.mjs";

// A beat on the opening HUD, so the Charge the placement must not change is on screen as itself
// before the rock lands, and a beat after it for the reading to be compared against.
const LEAD_TICKS = 1.5 * SECOND;
const TAIL_TICKS = 2 * SECOND;

export default function item() {
  // The HUD before and after the placement, read by `assert`.
  let c0;
  let stamps0;
  let s1;

  return {
    id: "economy.placement-free",

    async arrange(api) {
      const s0 = await startBuild(api);
      c0 = s0.charge;
      stamps0 = s0.stampsLeft;
    },

    async act(api) {
      await api.advance(LEAD_TICKS); // the HUD before the placement

      await placeCandidate(api, "capacitor", 1, 6, 7);
      s1 = await snap(api);

      await api.advance(TAIL_TICKS); // the same HUD after it: Charge held, one stamp gone
    },

    async assert(api, check) {
      check.expectEq("placing a rock costs no Charge", s1.charge, c0);
      check.expectEq("placing a rock spends one stamp of the allowance", s1.stampsLeft, stamps0 - 1);
    },
  };
}
