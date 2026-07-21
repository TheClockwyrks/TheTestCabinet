// Automated validation for modes.credits-survive.
//
// Credits already banked survive a death. We bank Credits, die, and confirm the balance is intact
// on the Game Over screen.

import {
  newRun,
  arrangeKillByHull,
  actKillByHull,
  SPAWN_COL,
  ROCKBED_ROW,
} from "../_helpers.mjs";

export default function item() {
  let end;

  return {
    id: "modes.credits-survive",

    // Bank a recognisable balance, then set up the hull death — the death itself is left to the
    // real death path when time runs forward in `act`.
    async arrange(api) {
      await newRun(api, { mode: "standard" });
      await api.call("grantCredits", 500);
      await arrangeKillByHull(api, SPAWN_COL, ROCKBED_ROW);
    },

    async act(api) {
      end = await actKillByHull(api);
    },

    async assert(api, check) {
      check.expectEq("the run ended", end.screen, "game-over");
      check.expectEq("banked Credits survive the death", end.credits, 500);
    },
  };
}
