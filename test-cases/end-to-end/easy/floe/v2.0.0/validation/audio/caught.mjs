// Automated validation for the Audio item `caught`: a cue plays when a hunter's bear
// catches the critter. Audio is read from the Web Audio sources the build starts (see
// `api.audio`). The critter is posed on a cleared ice tile, a bear is placed on that
// same tile, audio is armed, and the real pursuit logic is stepped so the catch fires;
// the audio log must grow across it. Lives stay at the fresh-run default so the death
// respawns rather than ending the run, isolating the caught cue.

import { startCrossing, armAudio, audioCount, ICE_TOP } from "../_helpers.mjs";

export default function item() {
  let before;
  let after;
  let caught;

  return {
    id: "audio.caught",

    async arrange(api) {
      await startCrossing(api);
      const row = ICE_TOP + 1;
      await api.call("setLane", row, { cols: [] }); // clear the ice so only the bear kills
      await api.call("placeCritter", 20, row);
      await api.call("setBear", 0, { col: 20, row }); // a bear on the critter's tile
      await armAudio(api);
    },

    async act(api) {
      before = await audioCount(api);
      const r = await api.until((s) => s.phase !== "crossing", {
        max: 30,
        poll: 1,
      });
      after = await audioCount(api);
      caught = r.hit;
      await api.advance(30); // a short tail so the clip shows the catch
    },

    async assert(api, check) {
      check.expectOk("the bear catches the critter", caught);
      check.expectGt(
        "a caught cue plays (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
