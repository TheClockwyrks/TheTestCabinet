// Automated validation for the Movement item `refuse-shore`.
//
// Hopping up into the solid far-shore wall between the bays is refused — no move,
// no death. The critter is stood on a floe just below a solid-shore column
// (`SHORE_COL`, between bay 0 and bay 1 under either reading of the bay layout) so
// it survives there, then a real up-hop is refused. See validation/_helpers.mjs.
//
// THE FOOTING IS READ AFTER A STEP, not off the placement that posed it — see
// `actFooting`. It is a precondition of this item rather than its subject: what is
// scored is that the wall refuses the hop, and the footing is here so a refusal
// measured on a critter that was never standing anywhere cannot pass for one.

import {
  actFooting,
  actRefusedHop,
  startCrossing,
  SHORE_COL,
  WATER_TOP,
} from "../_helpers.mjs";

export default function item() {
  // The footing under the critter, and the state after the refused hop.
  let footing;
  let after;

  return {
    id: "movement.refuse-shore",

    // `SHORE_COL` is solid shore, between bay 0 and bay 1. The floe below it is what
    // lets the critter stand there long enough to try the hop at all.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setBear", 0, null); // nothing but the wall decides this item
      await api.call("setLane", WATER_TOP, { cols: [SHORE_COL], speed: 0 });
      await api.call("placeCritter", SHORE_COL, WATER_TOP);
    },

    // The refused hop into the wall — what is checked, and the clip. The footing read
    // costs the clip a single tick before it.
    async act(api) {
      footing = await actFooting(api);
      after = await actRefusedHop(api, "ArrowUp");
    },

    async assert(api, check) {
      check.expectEq(
        "standing on a floe below the solid shore",
        footing,
        "floe",
      );
      check.expectEq(
        "a hop up into the solid far-shore is refused (row unchanged)",
        after.critter.row,
        WATER_TOP,
      );
      check.expectEq("no death", after.screen, "playing");
      check.expectNe("still crossing", after.phase, "dying");
    },
  };
}
