// Automated validation for the Movement item `refuse-edge`.
//
// A hop that would leave the strait is refused — the critter does not move and
// does not die. Two edges are checked through the real play code: a leftward hop
// from the leftmost column, and a downward hop from the near shore. See
// validation/_helpers.mjs.
//
// BOTH EDGES ARE DRIVEN IN THE SAME COLUMN. The critter walks into the side edge on
// column 0 and then into the bottom edge on column 0 of the near shore, so the move
// between the two halves is a drop down one column rather than a jump across the
// strait, and the clip reads as one critter meeting two boundaries.
//
// THE BEAR IS TAKEN OFF THE BOARD, and it has to be for a clip this long. A refusal
// is only legible if the critter is held on camera either side of it, and the critter
// is posed part-way up the strait — which is the condition a hunter emerges on
// (specs/hunter.md). Over the tenth of a second the check used to film that never
// mattered; over the seconds it films now, a bear can reach the posed critter and end
// the crossing mid-reading, which decides a movement item on the hunt. `setBear` is a
// control op, so it can be repeated between the halves without touching the clock.

import {
  actRefusedHop,
  startCrossing,
  ICE_TOP,
  ROW_NEAR,
} from "../_helpers.mjs";

// The first half's tail is short: the second half opens with its own lead, which is
// already a hold on a critter that has not moved.
const FIRST_TAIL_TICKS = 24; // 0.2 s

export default function item() {
  // The state after each refused hop.
  let sLeft;
  let sDown;

  return {
    id: "movement.refuse-edge",

    // Pose the left edge: a cleared ice lane so nothing but the strait boundary can
    // stop the hop, and the critter on its leftmost tile.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setBear", 0, null);
      await api.call("setLane", ICE_TOP, { cols: [] });
      await api.call("placeCritter", 0, ICE_TOP); // leftmost ice tile
    },

    // Both edges in one run: the leftward hop off the side, then the downward hop
    // below the near shore. The move between them is `placeCritter` alone — a control
    // op, so the clock stays with the runtime and the recording keeps rolling.
    async act(api) {
      sLeft = await actRefusedHop(api, "ArrowLeft", { tail: FIRST_TAIL_TICKS });

      // Below the near shore, in the same column. The bear is cleared again: the
      // critter counted as advanced through the first half, so one may have re-emerged
      // onto the near shore this half poses the critter back onto.
      await api.call("setBear", 0, null);
      await api.call("placeCritter", 0, ROW_NEAR);
      sDown = await actRefusedHop(api, "ArrowDown");
    },

    async assert(api, check) {
      check.expectEq(
        "a hop off the left edge is refused (column unchanged)",
        sLeft.critter.col,
        0,
      );
      check.expectEq(
        "no death from a refused edge hop",
        sLeft.screen,
        "playing",
      );
      check.expectNe("still crossing", sLeft.phase, "dying");
      check.expectEq(
        "a hop below the near shore is refused (row unchanged)",
        sDown.critter.row,
        ROW_NEAR,
      );
      check.expectEq("no death", sDown.screen, "playing");
    },
  };
}
