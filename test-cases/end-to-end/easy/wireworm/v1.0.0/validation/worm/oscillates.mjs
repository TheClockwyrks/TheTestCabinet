// Automated validation for worm.oscillates: the worm's vertical heading flips at
// the extremes — it reverses at the floor and again at the top — so it oscillates up
// and down rather than leaving the board.
//
// The worm is posed at each extreme heading into it; the dv flip is produced by the
// real stepWorm drop path and read back.

import {
  actWormStep,
  freshBoard,
  head,
  setWorm,
  straightWorm,
} from "../_helpers.mjs";

export default function item() {
  let floor;
  let ceil;

  return {
    id: "worm.oscillates",

    // Only the FLOOR scenario is posed here. The old script separated the two
    // extremes with a second `freshBoard`, which calls `api.reset` — forbidden inside
    // `act`, where it would take the clock back and silently freeze the recording —
    // so the ceiling scenario is re-posed below with control ops.
    async arrange(api) {
      // Floor: at the bottom row heading down, the next drop flips dv to up.
      await freshBoard(api);
      await setWorm(api, straightWorm(39, 19, 3, 1), 1, 1); // right edge, bottom row, heading down
      await api.call("setCursor", 100, 700); // clear of the worm's column
    },

    async act(api) {
      floor = await actWormStep(api);

      // Ceiling: at the top row heading up, the next drop flips dv to down. Re-posed
      // with control ops: `setWorm` REPLACES the worms outright, so the floor
      // scenario's worm cannot survive into this one, and `clearField` clears any
      // node — though the floor turn is an edge turn, which charges nothing, so
      // there should be none. No foe is ever spawned here, which is what makes the
      // pair safe to run back to back without a reset between them.
      await api.call("clearField");
      await setWorm(api, straightWorm(0, 0, 3, -1), -1, -1); // left edge, top row, heading up
      ceil = await actWormStep(api);

      // Both snapshots are captured; the sim runs on only so the clip ends on the
      // worm actually winding down the board rather than on a single tile-step.
      await api.advance(120); // 1s of visible play
    },

    async assert(api, check) {
      check.expectEq(
        "the worm reverses to climbing at the floor",
        floor.worms[0].dv,
        -1,
      );
      check.expectLt("the head steps upward off the floor", head(floor).r, 19);

      check.expectEq(
        "the worm reverses to descending at the top",
        ceil.worms[0].dv,
        1,
      );
      check.expectGt("the head steps downward off the top", head(ceil).r, 0);
    },
  };
}
