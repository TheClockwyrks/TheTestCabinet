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
// WHAT THE STILL SHOWS. The capture used to be taken after the three drops, on a board none of
// them had changed — which is the difficulty with filming a refusal: the correct outcome is that
// nothing happens, so a picture of the aftermath is a picture of an untouched yard and is
// indistinguishable from a build that was never asked. It read as a tower placed somewhere valid
// with the platform left clear beside it, which demonstrates nothing about the platform being
// protected.
//
// So a rock is pulled from the press and held over the platform's ARM before the still is taken,
// with its footprint cue reading illegal (`#ff4d4d`, `specs/controls.md`). The arm is the tile
// worth showing of the three: a build that protects only the anchor tile the map table lists
// draws a legal cue there, so the still is the difference between the two readings of the rule,
// and the ghost's own position and legality are asserted alongside the refusals.
//
// Opening the run, reading the waypoint, and the held rock the still is taken over are the
// arrange; the three REFUSED placements are the behavior under test and are the act.

import { startBuild, hoverHeldRock, heldCovers, snap } from "../_helpers.mjs";

export default function item() {
  // The waypoint aimed at, the opening board, and the board after each refused drop.
  let wp;
  let stem;
  let before;
  let stamps0;
  let heldOverArm;
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

      // Hold a rock over the platform's outer arm and capture it there, so the still shows the
      // game refusing the placement rather than an untouched yard.
      //
      // The hover and the capture are in `arrange` deliberately: a held ghost is drawn from the
      // game's pointer, and a build may let the REAL mouse own that pointer while it runs on its
      // own clock — which is what the record pass hands it for `act`. The reference does exactly
      // that, so a hover posed in `act` is overwritten before the next frame paints and the ghost
      // is drawn nowhere. `arrange` runs before the clock changes hands, so the debug pointer
      // holds in both passes. See `pathing/map-c-housings` for the same reasoning.
      heldOverArm = await hoverHeldRock(api, wp.col + 1, wp.row);
      await api.screenshot("refused");
    },

    async act(api) {
      // Covers `(c-1, r)`, the anchor `(c, r)`, and the stem row.
      sAnchor = await drop(api, wp.col - 1, wp.row);
      // Covers ONLY the outer arm `(c+1, r)` — no anchor tile, no stem tile.
      sArm = await drop(api, wp.col + 1, stem.row < wp.row ? wp.row : wp.row - 1);
      // Covers ONLY the stem tile (anchored away from the platform's row, either way the stem points).
      sStem = await drop(api, wp.col - 1, stem.row < wp.row ? stem.row - 1 : stem.row);
    },

    async assert(api, check) {
      check.expectOk(
        "a rock is held over the platform's outer arm",
        heldCovers(heldOverArm, wp.col + 1, wp.row),
      );
      check.expectOk(
        "...and its footprint cue reads illegal there, so the arm is protected too",
        Boolean(heldOverArm) && heldOverArm.legal === false,
      );

      check.expectEq("a placement covering the waypoint anchor lands no candidate", sAnchor.towers.length, before);
      check.expectEq("...and consumes no stamp", sAnchor.stampsLeft, stamps0);
      check.expectEq("a placement covering only the platform's outer arm lands no candidate", sArm.towers.length, before);
      check.expectEq("...and consumes no stamp", sArm.stampsLeft, stamps0);
      check.expectEq("a placement covering only the platform's stem lands no candidate", sStem.towers.length, before);
      check.expectEq("...and consumes no stamp", sStem.stampsLeft, stamps0);
    },
  };
}
