// Automated validation for modes.hardcore-permadeath.
//
// In Hardcore a death deletes the save (permadeath). We save at the surface in Hardcore, die, and
// confirm no save remains.

import {
  newRun,
  arrangeKillByHull,
  actKillByHull,
  SPAWN_COL,
  ROCKBED_ROW,
} from "../_helpers.mjs";

export default function item() {
  let saved;
  let end;

  return {
    id: "modes.hardcore-permadeath",

    // A saved Hardcore expedition, then the hull death set up — the death itself is left to the
    // real death path when time runs forward in `act`.
    async arrange(api) {
      await newRun(api, { mode: "hardcore" });
      await api.call("save");
      saved = (await api.snapshot()).hasSave;
      await arrangeKillByHull(api, SPAWN_COL, ROCKBED_ROW);
    },

    async act(api) {
      end = await actKillByHull(api);
    },

    async assert(api, check) {
      check.expectEq("the expedition is saved", saved, true);
      check.expectEq(
        "a Hardcore death reaches Game Over",
        end.screen,
        "game-over",
      );
      check.expectEq(
        "the save is deleted on a Hardcore death",
        end.hasSave,
        false,
      );
    },
  };
}
