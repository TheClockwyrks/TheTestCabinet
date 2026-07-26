// Automated validation for the Audio item `fire-cue`: a distinct short cue plays
// when an emitter fires. Audio is read from the Web Audio sources the build starts
// (see `api.audio`). An Arc is placed with a real Core in range and heated enough to
// fire at real damage; audio is armed, and the real firing system's first shot must
// grow the audio log.

import {
  newGame,
  combatSetup,
  armAudio,
  audioCount,
  TICK,
} from "../_helpers.mjs";

export default function item() {
  let id;
  let before;
  let after;
  let fired;

  return {
    id: "audio.fire-cue",

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      const c = await combatSetup(api, "arc", 3, 20);
      id = c.id;
      await api.call("setHeat", id, 80); // hot enough to fire at real damage
      await armAudio(api);
    },

    // 360 ticks = the old 6s cap; polling every tick catches the first shot rather
    // than a state several shots later.
    async act(api) {
      before = await audioCount(api);
      const r = await api.until(
        (s) => s.towers.some((t) => t.id === id && t.firing),
        { max: 360, poll: TICK },
      );
      after = await audioCount(api);
      fired = r.hit;
      await api.advance(30); // a short tail so the clip shows the shot
    },

    async assert(api, check) {
      check.expectOk("the Arc fires at the Core in range", fired);
      check.expectGt(
        "a cue plays when an emitter fires (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
