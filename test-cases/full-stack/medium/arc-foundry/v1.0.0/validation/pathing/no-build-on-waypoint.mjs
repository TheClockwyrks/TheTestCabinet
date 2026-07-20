// Automated validation for pathing.no-build-on-waypoint: a placement whose footprint would
// cover a waypoint-platform tile is refused, so a waypoint can never be walled off.
//
// The first waypoint's anchor is read from the snapshot; a 2x2 anchored one tile left of it
// covers platform tiles and is refused (nothing lands, no stamp spent).
//
// Opening the run and reading the waypoint are the arrange; the REFUSED placement is the
// behavior under test and is the act.

import { startBuild, snap } from "../_helpers.mjs";

// A frame for the still, so the capture shows the untouched waypoint. 100 ms = 6 ticks.
const SETTLE_TICKS = 6;

export default function item() {
  // The waypoint aimed at, the opening board, and the board after the refused drop.
  let wp;
  let before;
  let stamps0;
  let s1;

  return {
    id: "pathing.no-build-on-waypoint",

    async arrange(api) {
      const s0 = await startBuild(api);
      wp = s0.waypoints[0];
      before = s0.towers.length;
      stamps0 = s0.stampsLeft;
    },

    async act(api) {
      await api.call("setNextRoll", "capacitor", 1);
      await api.call("placeRock", wp.col - 1, wp.row); // footprint covers the waypoint platform
      s1 = await snap(api);

      await api.advance(SETTLE_TICKS);
      await api.screenshot("refused");
    },

    async assert(api, check) {
      check.expectEq("a placement on a waypoint platform lands no candidate", s1.towers.length, before);
      check.expectEq("...and consumes no stamp", s1.stampsLeft, stamps0);
    },
  };
}
