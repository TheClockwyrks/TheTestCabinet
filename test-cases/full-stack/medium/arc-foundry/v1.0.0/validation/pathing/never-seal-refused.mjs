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
// for the reason this item is about. It is also legible as a still: two rocks bracketing the
// vent and a third bouncing off the gap between them.
//
// Only opening the run is arranged; the two accepted bracket rocks, the refused seal, and the
// legal placement that follows it are all the behavior under test, so they are the act.

import { startBuild, snap, SECOND } from "../_helpers.mjs";

// A beat between drops so the clip reads as a sequence rather than a jump cut, and a moment on
// the final board for the still.
const BEAT_TICKS = 0.5 * SECOND;
const SETTLE_TICKS = 1 * SECOND;

// The two bracket rocks, the sealing rock they set up, and a legal drop in the open yard.
const BRACKET_A = { col: 0, row: 3 }; // walls (0,4) and (1,4), just above the Entry
const BRACKET_B = { col: 0, row: 7 }; // walls (0,6) and (1,6), just below it
const SEAL = { col: 1, row: 5 }; // closes the last mouth: the Entry is then walled in
const LEGAL = { col: 12, row: 10 }; // open yard, nowhere near the chain

export default function item() {
  // The board after each stage.
  let before;
  let stamps0;
  let sBracket;
  let sSeal;
  let sLegal;

  return {
    id: "pathing.never-seal-refused",

    async arrange(api) {
      const s0 = await startBuild(api);
      before = s0.towers.length;
      stamps0 = s0.stampsLeft;
    },

    async act(api) {
      // Two legal rocks that narrow the Entry's mouth without closing it.
      for (const spot of [BRACKET_A, BRACKET_B]) {
        await api.call("setNextRoll", "capacitor", 1);
        await api.call("placeRock", spot.col, spot.row);
        await api.advance(BEAT_TICKS);
      }
      sBracket = await snap(api);

      // The rock that would close the last way out of the Entry: the never-seal rule refuses it.
      await api.call("setNextRoll", "capacitor", 1);
      await api.call("placeRock", SEAL.col, SEAL.row);
      await api.advance(BEAT_TICKS);
      sSeal = await snap(api);

      // The same rock IS accepted in the open yard, so the refusal is about the seal and not
      // about the press having stopped working.
      await api.call("setNextRoll", "capacitor", 1);
      await api.call("placeRock", LEGAL.col, LEGAL.row);
      sLegal = await snap(api);

      await api.advance(SETTLE_TICKS);
      await api.screenshot("refused");
    },

    async assert(api, check) {
      check.expectEq("the two bracket rocks are accepted", sBracket.towers.length, before + 2);
      check.expectEq("...spending a stamp each", sBracket.stampsLeft, stamps0 - 2);

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
