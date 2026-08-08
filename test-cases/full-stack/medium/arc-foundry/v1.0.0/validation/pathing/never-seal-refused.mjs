// Automated validation for pathing.never-seal-refused: a placement that would seal a
// waypoint segment is refused and changes nothing, while a legal placement is accepted.
//
// WHAT THE REFUSED PLACEMENT IS. This used to drop a rock anchored at (48,19), whose 2x2
// footprint covers the Collector tile (49,20) itself. That is refused by any sane build — but
// so is a rock on the Collector under a build that simply protects the Entry and Collector
// tiles, or one that refuses any footprint overlapping a chain endpoint, neither of which is
// the never-seal rule. The check could not tell the rule it names from three other reasons to
// say no, and a reviewer watching the still could not either: nothing about a rock bouncing off
// the sink shows a SEGMENT being kept open.
//
// So the refusal is engineered to have exactly one cause. On the Substation the Entry is the
// single edge tile (0,5) (`specs/board.md`, Map A). Two rocks are placed clear of it, at (0,3)
// and (0,7), which between them wall (0,4)/(1,4) above and (0,6)/(1,6) below — both accepted,
// because the Load can still leave the Entry eastward through (1,5). That leaves a two-tile
// mouth, and a third rock at (1,5) closes it: after it, the only tiles the Entry touches are
// walls, so the E->WP1 segment has no open route and the placement must be refused.
//
// That third rock covers no waypoint-platform tile, no fixed housing, no Entry or Collector
// tile, and overlaps no existing footprint. Every other reason to refuse a placement is off the
// table, so a build that accepts it has no never-seal rule, and one that refuses it is refusing
// for the reason this item is about.
//
// WHAT THE STILL SHOWS. The capture used to be taken after the whole sequence had run, on the
// board the last (legal) placement left behind. But a refused placement leaves the board exactly
// as it was, so nothing in that picture is the refusal: a reviewer saw two rocks by the vent and
// a third rock somewhere else entirely, which is a picture of a placement being ACCEPTED, and
// read as a tower sitting in a valid spot with a gap left open beside it. The one thing the item
// exists to demonstrate — the game saying no — was not in its evidence.
//
// So the press is pulled and the rock held over the sealing tile BEFORE the still is taken, with
// its footprint cue reading illegal (`#ff4d4d`, `specs/controls.md`), and the ghost's own
// position and legality are asserted alongside the refusal. The still is then the game visibly
// refusing the placement, over the exact tile the rule is about, with the two bracket rocks that
// made it the last way out on either side of it.
//
// Opening the run, the two accepted bracket rocks, and the held rock the still is taken over are
// the arrange; the REFUSED seal and the legal placement that follows it are the behavior under
// test and are the act.

import { startBuild, hoverHeldRock, heldCovers, snap } from "../_helpers.mjs";

// The two bracket rocks, the sealing rock they set up, and a legal drop in the open yard. Each
// anchor is the top-left of a 2x2 (`specs/board.md`), so BRACKET_A walls (0,3)..(1,4) above the
// Entry and BRACKET_B walls (0,7)..(1,8) below it. That leaves the Entry at (0,5) reaching only
// (1,5) and (0,6), and the SEAL rock covers (1,5)..(2,6) — after which (0,6) is a pocket with no
// way out and the E->WP1 segment has no open route.
const BRACKET_A = { col: 0, row: 3 };
const BRACKET_B = { col: 0, row: 7 };
const SEAL = { col: 1, row: 5 }; // closes the last mouth: the Entry is then walled in
const LEGAL = { col: 12, row: 10 }; // open yard, nowhere near the chain

export default function item() {
  // The board after each stage.
  let before;
  let stamps0;
  let sBracket;
  let heldOverSeal;
  let sSeal;
  let sLegal;

  return {
    id: "pathing.never-seal-refused",

    async arrange(api) {
      const s0 = await startBuild(api);
      before = s0.towers.length;
      stamps0 = s0.stampsLeft;

      // Two legal rocks that narrow the Entry's mouth without closing it. Placements are control
      // ops and consume no game time, and this item declares a still rather than a clip, so they
      // pose the board rather than being played out.
      for (const spot of [BRACKET_A, BRACKET_B]) {
        await api.call("setNextRoll", "capacitor", 1);
        await api.call("placeRock", spot.col, spot.row);
      }
      sBracket = await snap(api);

      // Hold a rock over the tile that would close the last way out of the Entry, and capture it
      // there, so the still shows the game refusing the placement rather than a board on which
      // nothing happened.
      //
      // The hover and the capture are in `arrange` deliberately: a held ghost is drawn from the
      // game's pointer, and a build may let the REAL mouse own that pointer while it runs on its
      // own clock — which is what the record pass hands it for `act`. The reference does exactly
      // that, so a hover posed in `act` is overwritten before the next frame paints and the ghost
      // is drawn nowhere. `arrange` runs before the clock changes hands, so the debug pointer
      // holds in both passes. See `pathing/map-c-housings` for the same reasoning.
      heldOverSeal = await hoverHeldRock(api, SEAL.col, SEAL.row);
      await api.screenshot("refused");
    },

    async act(api) {
      // The drop the still was taken over: the never-seal rule refuses it and the board is
      // unchanged.
      await api.call("setNextRoll", "capacitor", 1);
      await api.call("placeRock", SEAL.col, SEAL.row);
      sSeal = await snap(api);

      // The same rock IS accepted in the open yard, so the refusal is about the seal and not
      // about the press having stopped working.
      await api.call("setNextRoll", "capacitor", 1);
      await api.call("placeRock", LEGAL.col, LEGAL.row);
      sLegal = await snap(api);
    },

    async assert(api, check) {
      check.expectEq("the two bracket rocks are accepted", sBracket.towers.length, before + 2);
      check.expectEq("...spending a stamp each", sBracket.stampsLeft, stamps0 - 2);

      check.expectOk(
        "a rock is held over the tile that would seal the segment",
        heldCovers(heldOverSeal, SEAL.col, SEAL.row),
      );
      check.expectOk(
        "...and its footprint cue reads illegal there",
        Boolean(heldOverSeal) && heldOverSeal.legal === false,
      );

      check.expectEq("a placement that would seal the segment lands no candidate", sSeal.towers.length, before + 2);
      check.expectEq("...and consumes no stamp", sSeal.stampsLeft, stamps0 - 2);
      check.expectOk(
        "...and leaves the sealed footprint empty",
        !sSeal.towers.some((t) => t.col === SEAL.col && t.row === SEAL.row),
      );

      check.expectEq("a legal placement elsewhere still lands a candidate", sLegal.towers.length, before + 3);
      check.expectEq("...and spends one stamp", sLegal.stampsLeft, stamps0 - 3);
    },
  };
}
