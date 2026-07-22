// Automated validation for presentation.miner-animation (the headline).
//
// The miner must animate a distinct cycle for each thing it does. Validation can only confirm the
// state machine REACHES each distinct animation state (idle, walk, drill-down, drill-side, jetpack,
// fall) and record a clip; whether the produced sprites read as characterful, distinct cycles is
// left to the reviewer. We pose each state and read miner.state back, then record a live clip.

import {
  K,
  newRun,
  standAt,
  solid,
  openColumn,
  SPAWN_COL,
  TOPSOIL_ROW,
  ROCKBED_ROW,
} from "../_helpers.mjs";

export default function item() {
  const col = SPAWN_COL;
  const states = {};

  return {
    id: "presentation.miner-animation",

    async arrange(api) {
      await newRun(api);
    },

    // Every cycle is reached by running the real sim, so the whole tour lives here — and that tour
    // IS the clip the reviewer judges the sprites from: each state is held long enough to read.
    // Each scenario is re-posed with control ops only (no reset, which would freeze the recording).
    async act(api) {
      // idle — standing still on the surface.
      await api.advance(12); // 12 ticks = 0.2 s
      states.idle = (await api.snapshot()).miner.state;

      // walk — holding a direction on solid ground.
      await api.call("keyDown", K.right);
      await api.advance(18); // 18 ticks = 0.3 s
      states.walk = (await api.snapshot()).miner.state;
      await api.call("keyUp", K.right);

      // drill-down — cutting the tile below.
      await standAt(api, col, TOPSOIL_ROW);
      await solid(api, col, TOPSOIL_ROW + 2);
      await api.call("keyDown", K.down);
      await api.advance(12); // 12 ticks = 0.2 s
      states.drillDown = (await api.snapshot()).miner.state;
      await api.call("keyUp", K.down);

      // drill-side — cutting into a wall.
      await standAt(api, col, ROCKBED_ROW);
      await solid(api, col + 1, ROCKBED_ROW);
      await api.call("keyDown", K.right);
      await api.advance(21); // 21 ticks = 0.35 s
      states.drillSide = (await api.snapshot()).miner.state;
      await api.call("keyUp", K.right);

      // jetpack — thrusting up an open shaft.
      await api.call("teleport", col, ROCKBED_ROW);
      await openColumn(api, col, ROCKBED_ROW - 5, ROCKBED_ROW - 1);
      await solid(api, col, ROCKBED_ROW + 1);
      await api.call("teleport", col, ROCKBED_ROW);
      await api.call("setFuel", 999);
      await api.call("keyDown", K.thrust);
      await api.advance(12); // 12 ticks = 0.2 s
      states.jetpack = (await api.snapshot()).miner.state;
      await api.call("keyUp", K.thrust);

      // fall — plunging down an open shaft.
      await api.call("teleport", col, ROCKBED_ROW);
      await openColumn(api, col, ROCKBED_ROW + 1, ROCKBED_ROW + 10);
      await solid(api, col, ROCKBED_ROW + 11);
      await api.call("teleport", col, ROCKBED_ROW);
      await api.advance(12); // 12 ticks = 0.2 s
      states.fall = (await api.snapshot()).miner.state;

      // A last stretch of the miner in motion for the reviewer to judge the sprites.
      // 72 ticks = 1.2 s, the old 1200 ms live tail.
      await api.advance(72);
    },

    async assert(api, check) {
      check.expectEq("reaches the idle cycle", states.idle, "idle");
      check.expectEq("reaches the walk cycle", states.walk, "walk");
      check.expectEq(
        "reaches the drill-down cycle",
        states.drillDown,
        "drill-down",
      );
      check.expectEq(
        "reaches the drill-side cycle",
        states.drillSide,
        "drill-side",
      );
      check.expectEq("reaches the jetpack cycle", states.jetpack, "jetpack");
      check.expectEq("reaches the fall cycle", states.fall, "fall");
    },
  };
}
