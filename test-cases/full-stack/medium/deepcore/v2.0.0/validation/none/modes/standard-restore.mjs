// Automated validation for modes.standard-restore.
//
// In Standard a death keeps the single save, so Game Over offers Continue From Save and restoring
// resumes the expedition. We save at the surface, die, confirm the save survived and Game Over, then
// take the Continue option and confirm play resumes.

import {
  newRun,
  arrangeKillByHull,
  actKillByHull,
  press,
  SPAWN_COL,
  ROCKBED_ROW,
} from "../_helpers.mjs";

export default function item() {
  let saved;
  let end;
  let restored;

  return {
    id: "modes.standard-restore",

    // A saved Standard expedition, then the hull death set up — the death itself is left to the
    // real death path when time runs forward in `act`.
    async arrange(api) {
      await newRun(api, { mode: "standard" });
      await api.call("save"); // at the surface
      saved = (await api.snapshot()).hasSave;
      await arrangeKillByHull(api, SPAWN_COL, ROCKBED_ROW);
    },

    // The death resolving and the restore that follows are both the behavior, so the clip shows the
    // whole round trip: die, take Continue From Save, and be back in the mine.
    async act(api) {
      // `actKillByHull` already rests on the Game Over screen, so CONTINUE FROM SAVE is on screen
      // and readable before it is taken — which is also what distinguishes this clip from the
      // Hardcore one, where the same screen offers PLAY AGAIN because the save is gone.
      end = await actKillByHull(api);
      await press(api, "Enter"); // Continue From Save (the first Game Over option)
      restored = (await api.snapshot()).screen;
      await api.advance(90); // 90 ticks = 1.5 s back in the mine, on the restored expedition
    },

    async assert(api, check) {
      check.expectEq("the expedition is saved", saved, true);
      check.expectEq(
        "a Standard death reaches Game Over",
        end.screen,
        "game-over",
      );
      check.expectEq("the save survives a Standard death", end.hasSave, true);
      check.expectEq("restoring resumes the expedition", restored, "in-mine");
    },
  };
}
