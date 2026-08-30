// Automated validation for cursor.fires-up: a bolt travels straight up the cursor's
// column and is consumed by the first thing it meets; on a clear column it vanishes
// at the top.
//
// Two preconditions: a node above the cursor (the bolt should stop at it) and a
// clear column (the bolt should exit the top, changing nothing). Both resolutions
// come from the real updateBolts/resolveBolt and are read back.

import {
  actFireAndResolve,
  chargeAt,
  freshBoard,
  tileCX,
} from "../_helpers.mjs";

export default function item() {
  let hit;
  let clear;

  return {
    id: "cursor.fires-up",

    // Only the FIRST scenario is posed here. The old script separated the two with a
    // second `freshBoard`, which calls `api.reset` — forbidden inside `act`, where it
    // would take the clock back and silently freeze the recording — so the clear-column
    // scenario is re-posed below with control ops.
    async arrange(api) {
      // A node directly above the cursor: the bolt stops at it.
      await freshBoard(api);
      await api.call("setNode", 20, 8, 0);
      await api.call("setCursor", tileCX(20), 688);
    },

    async act(api) {
      hit = await actFireAndResolve(api);

      // A clear column: the bolt exits the top and changes nothing. Ordering the
      // node scenario first is what makes this safe to re-pose: it ends with its own
      // node destroyed and spawns no foe, so there is nothing left to leak into the
      // "nothing on the board changed" assertion. `clearField` empties the nodes
      // anyway, making the precondition explicit rather than inherited.
      await api.call("clearField");
      await api.call("setCursor", tileCX(5), 688);
      clear = await actFireAndResolve(api);
    },

    async assert(api, check) {
      check.expectEq(
        "the bolt stops at the first node in its column",
        chargeAt(hit, 20, 8),
        -1,
      );
      check.expectEq("the bolt is consumed by the hit", hit.bolts.length, 0);

      check.expectEq(
        "the bolt vanishes at the top of a clear column",
        clear.bolts.length,
        0,
      );
      check.expectEq("nothing on the board changed", clear.nodes.length, 0);
    },
  };
}
