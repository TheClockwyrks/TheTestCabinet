// Automated validation for pathing.no-build-on-waypoint: a placement whose footprint would
// cover ANY tile of a 4-tile waypoint platform is refused, so a waypoint can never be walled
// off — and the protection is the whole platform, not just the anchor tile the map table lists.
//
// A platform is a T (specs/board.md): the three tiles `(c-1, r)`, `(c, r)`, `(c+1, r)` plus a
// stem one row off the anchor toward the board's vertical center. Three drops are attempted at
// the first waypoint, each refused for a different reason to rule out a build that only
// protects the center: one whose footprint covers the ANCHOR, one that covers ONLY the outer
// ARM `(c+1, r)`, and one that covers ONLY the STEM. Every one must land nothing and spend no
// stamp. (What is left buildable is the other half of the contract, checked by
// pathing.build-beside-waypoint.)
//
// Opening the run and reading the waypoint are the arrange; the REFUSED placements are the
// behavior under test and are the act.

import { startBuild, snap } from "../_helpers.mjs";

// A frame for the still, so the capture shows the untouched waypoint. 100 ms = 6 ticks.
const SETTLE_TICKS = 6;

export default function item() {
  // The waypoint aimed at, the opening board, and the board after each refused drop.
  let wp;
  let stem;
  let before;
  let stamps0;
  let sAnchor;
  let sArm;
  let sStem;

  // Drop a rock anchored at (col,row) and read the board back.
  async function drop(api, col, row) {
    await api.call("setNextRoll", "capacitor", 1);
    await api.call("placeRock", col, row);
    return snap(api);
  }

  return {
    id: "pathing.no-build-on-waypoint",

    async arrange(api) {
      const s0 = await startBuild(api);
      wp = s0.waypoints[0];
      // The stem sits one row off the anchor toward the vertical center (row 16).
      stem = { col: wp.col, row: wp.row < 16 ? wp.row + 1 : wp.row - 1 };
      before = s0.towers.length;
      stamps0 = s0.stampsLeft;
    },

    async act(api) {
      // Covers `(c-1, r)`, the anchor `(c, r)`, and the stem row.
      sAnchor = await drop(api, wp.col - 1, wp.row);
      // Covers ONLY the outer arm `(c+1, r)` — no anchor tile, no stem tile.
      sArm = await drop(api, wp.col + 1, stem.row < wp.row ? wp.row : wp.row - 1);
      // Covers ONLY the stem tile (anchored away from the platform's row, either way the stem points).
      sStem = await drop(api, wp.col - 1, stem.row < wp.row ? stem.row - 1 : stem.row);

      await api.advance(SETTLE_TICKS);
      await api.screenshot("refused");
    },

    async assert(api, check) {
      check.expectEq("a placement covering the waypoint anchor lands no candidate", sAnchor.towers.length, before);
      check.expectEq("...and consumes no stamp", sAnchor.stampsLeft, stamps0);
      check.expectEq("a placement covering only the platform's outer arm lands no candidate", sArm.towers.length, before);
      check.expectEq("...and consumes no stamp", sArm.stampsLeft, stamps0);
      check.expectEq("a placement covering only the platform's stem lands no candidate", sStem.towers.length, before);
      check.expectEq("...and consumes no stamp", sStem.stampsLeft, stamps0);
    },
  };
}
