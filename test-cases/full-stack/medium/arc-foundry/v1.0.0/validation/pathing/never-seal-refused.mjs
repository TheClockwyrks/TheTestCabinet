// Automated validation for pathing.never-seal-refused: a placement that would seal a
// waypoint segment is refused and changes nothing, while a legal placement is accepted.
//
// On the default map the Collector is tile (49,20); a 2x2 anchored at (48,19) would cover it
// and seal the final WP->Collector segment, so the real placement path refuses it (no
// candidate lands, the stamp allowance is unchanged). A legal placement elsewhere then
// lands normally, confirming the op itself works.
//
// Only opening the run is arranged; the refused drop and the legal one that follows it are the
// behavior under test, so both are the act — the clip shows one rock bounce and the next land.

import { startBuild, snap } from "../_helpers.mjs";

// A frame for the still, so the capture shows the landed legal placement. 100 ms = 6 ticks.
const SETTLE_TICKS = 6;

export default function item() {
  // The opening board and the board after each drop.
  let before;
  let stamps0;
  let s1;
  let s2;

  return {
    id: "pathing.never-seal-refused",

    async arrange(api) {
      const s0 = await startBuild(api);
      before = s0.towers.length;
      stamps0 = s0.stampsLeft;
    },

    async act(api) {
      // A placement that would seal the final segment (covering the Collector tile).
      await api.call("setNextRoll", "capacitor", 1);
      await api.call("placeRock", 48, 19);
      s1 = await snap(api);

      // A legal placement in the open yard IS accepted.
      await api.call("setNextRoll", "capacitor", 1);
      await api.call("placeRock", 6, 10);
      s2 = await snap(api);

      await api.advance(SETTLE_TICKS);
      await api.screenshot("refused");
    },

    async assert(api, check) {
      check.expectEq("a sealing placement lands no candidate", s1.towers.length, before);
      check.expectEq("a refused placement consumes no stamp", s1.stampsLeft, stamps0);
      check.expectEq("a legal placement lands a candidate", s2.towers.length, before + 1);
      check.expectEq("...and spends one stamp", s2.stampsLeft, stamps0 - 1);
    },
  };
}
