// Automated validation for rocket.parts-durable.
//
// Rocket components already installed stay installed across a death. We fabricate two parts, cause a
// death, and confirm they are still installed on the Game Over screen.

import {
  newRun,
  arrangeKillByHull,
  actKillByHull,
  SPAWN_COL,
  ROCKBED_ROW,
} from "../_helpers.mjs";

export default function item() {
  let installed;
  let end;

  return {
    id: "rocket.parts-durable",

    // Two parts on the rocket, then the hull death set up — the death itself is left to the real
    // death path when time runs forward in `act`.
    async arrange(api) {
      await newRun(api);
      await api.call("grantCredits", 15000);
      await api.call("fabricate"); // hull-frame
      await api.call("fabricate"); // fuel-cells
      installed = (await api.snapshot()).rocket.installed.length;
      await arrangeKillByHull(api, SPAWN_COL, ROCKBED_ROW);
    },

    async act(api) {
      end = await actKillByHull(api);
    },

    async assert(api, check) {
      check.expectEq("two parts are installed before the death", installed, 2);
      check.expectEq("the run ended", end.screen, "game-over");
      check.expectOk(
        "the Hull Frame survives the death",
        end.rocket.installed.includes("hull-frame"),
      );
      check.expectOk(
        "the Fuel Cells survive the death",
        end.rocket.installed.includes("fuel-cells"),
      );
    },
  };
}
