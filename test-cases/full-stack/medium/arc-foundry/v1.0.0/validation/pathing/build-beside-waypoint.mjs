// Automated validation for pathing.build-beside-waypoint: the non-buildable zone is exactly the
// waypoint platform's own four tiles, and not one tile wider.
//
// The complement of pathing.no-build-on-waypoint. A build that refuses everything NEAR a
// waypoint — dilating the platform by a tile — still passes the refusal check but breaks the
// game: mazing a waypoint means walling right up against its platform, and the specs' inset
// guarantee (specs/board.md) is what makes folding the route around either side possible.
//
// Three rocks are dropped at the first waypoint, each hugging the platform (specs/board.md: the
// three tiles `(c-1, r)`, `(c, r)`, `(c+1, r)` plus a stem one row off the anchor toward the
// board's vertical center) without covering any of its tiles: one beyond the outer ARM, one on
// the row just outside the platform's row, and one beside the STEM. Each must LAND a candidate
// and spend its stamp. None of the three seals a segment — the platform keeps an open way in
// along its row and an open way out past the stem — so the never-seal rule is not what is being
// read here.
//
// Opening the run is the arrange; the three ACCEPTED placements are the behavior under test and
// are the act.

import { startBuild, snap, stemRow, towerAt } from "../_helpers.mjs";

// A frame for the still, so the capture shows the three walls standing against the platform.
// 100 ms = 6 ticks.
const SETTLE_TICKS = 6;

export default function item() {
  // The waypoint hugged, the three anchors tried, and the board after the drops.
  let wp;
  let spots;
  let stamps0;
  let s1;

  return {
    id: "pathing.build-beside-waypoint",

    async arrange(api) {
      const s0 = await startBuild(api);
      wp = s0.waypoints[0];
      stamps0 = s0.stampsLeft;

      // Which way the stem points decides which side of the platform's row is clear for a 2x2.
      // The rule itself lives in `stemRow` (`specs/board.md`: one row off the anchor toward the
      // board's vertical centre), so this reads the direction off it rather than restating it.
      const down = stemRow(wp.row) > wp.row; // stem at (c, r+1); the row above the platform is free
      const outsideRow = down ? wp.row - 2 : wp.row + 1; // a 2x2 that stops one row short of `r`
      const besideStem = down ? wp.row + 1 : wp.row - 2; // a 2x2 alongside the stem, never on it
      spots = [
        { name: "beyond the outer arm", col: wp.col + 2, row: wp.row },
        { name: "on the row outside the platform", col: wp.col - 1, row: outsideRow },
        { name: "beside the stem", col: wp.col - 2, row: besideStem },
      ];
    },

    async act(api) {
      for (const spot of spots) {
        await api.call("setNextRoll", "capacitor", 1);
        await api.call("placeRock", spot.col, spot.row);
      }
      s1 = await snap(api);

      await api.advance(SETTLE_TICKS);
      await api.screenshot("beside");
    },

    async assert(api, check) {
      for (const spot of spots) {
        check.expectOk(`a placement ${spot.name} is accepted`, !!towerAt(s1, spot.col, spot.row));
      }
      check.expectEq("...and each accepted placement spent its stamp", s1.stampsLeft, stamps0 - spots.length);
    },
  };
}
