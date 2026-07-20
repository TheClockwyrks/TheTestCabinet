// Automated validation for the Movement item `refuse-shore`.
//
// Hopping up into the solid far-shore wall between the bays is refused — no move,
// no death. The critter is stood on a floe just below a solid-shore column (col 8,
// between bay 0 and bay 1) so it survives there, then a real up-hop is refused.
// See validation/_helpers.mjs.

import { startCrossing, WATER_TOP } from "../_helpers.mjs";

export default function item() {
  // The footing before the hop (read instantly in `arrange`) and the state after it.
  let footing;
  let after;

  return {
    id: "movement.refuse-shore",

    // Col 8 is solid shore, between bay 0 and bay 1. The floe below it is what lets
    // the critter stand there long enough to try the hop at all.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setLane", WATER_TOP, { cols: [8], speed: 0 }); // floe under col 8
      await api.call("placeCritter", 8, WATER_TOP);
      footing = (await api.snapshot()).critter.footing;
    },

    // The refused hop into the wall — what is checked, and the clip.
    async act(api) {
      await api.call("press", "ArrowUp");
      await api.advance(18); // 0.15 s, just past the hop cooldown
      after = await api.snapshot();
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
