// Automated validation for the Movement item `refuse-vehicle`.
//
// Hopping into a tile a vehicle already occupies is refused like a wall — the
// critter does not move and does not die (death comes only when traffic runs into
// you). A stationary plow is parked on the tile beside the critter, then a real
// hop toward it is attempted. See validation/_helpers.mjs.

import { startCrossing, ICE_TOP } from "../_helpers.mjs";

export default function item() {
  // The state after the refused hop.
  let after;

  return {
    id: "movement.refuse-vehicle",

    // A PARKED plow (speed 0) beside the critter: stationary, so nothing runs into
    // the critter and the only thing under test is the refusal. Three lives, so a
    // stray crush would show up as a decrement.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setLives", 3);
      await api.call("setLane", ICE_TOP, { cols: [21], speed: 0 }); // plow parked on cols 21..23
      await api.call("placeCritter", 20, ICE_TOP);
    },

    // The refused hop into the parked vehicle — what is checked, and the clip.
    async act(api) {
      await api.call("press", "ArrowRight");
      await api.advance(24); // 0.2 s, well past the hop cooldown
      after = await api.snapshot();
    },

    async assert(api, check) {
      check.expectEq(
        "a hop into a vehicle-occupied tile is refused (column unchanged)",
        after.critter.col,
        20,
      );
      check.expectEq(
        "no death from a refused hop into traffic",
        after.screen,
        "playing",
      );
      check.expectNe(
        "no crush from stepping toward parked traffic",
        after.phase,
        "dying",
      );
      check.expectEq("lives unchanged", after.lives, 3);
    },
  };
}
