// Automated validation for the Audio item `death-cue`: a distinct cue plays when a
// surge unit dies. Audio is read from the Web Audio sources the build starts (see
// `api.audio`). An Arc is placed hot enough to kill outright and a real Mote spawned
// into its range (the same setup as `economy.bounty`); audio is armed, and the real
// firing/damage system killing the Mote must grow the audio log.

import {
  newGame,
  build,
  spawn,
  armAudio,
  audioCount,
  TICK,
} from "../_helpers.mjs";

export default function item() {
  let before;
  let after;
  let killed;

  return {
    id: "audio.death-cue",

    // A hot Arc and a Mote with nothing to protect it, and a zeroed balance, so the
    // Mote's death is the only thing that can pay out money.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      const id = await build(api, "arc", 3, 20);
      await api.call("setHeat", id, 80); // hot enough to kill outright
      await api.call("setMoney", 0);
      await spawn(api, "mote", "left");
      await armAudio(api);
    },

    // 360 ticks = the old 6s cap; polling every tick reads the balance at the kill.
    async act(api) {
      before = await audioCount(api);
      const r = await api.until((s) => s.money > 0, { max: 360, poll: TICK });
      after = await audioCount(api);
      killed = r.hit;
      await api.advance(30); // a short tail so the clip shows the kill
    },

    async assert(api, check) {
      check.expectOk("the Arc kills the Mote", killed);
      check.expectGt(
        "a cue plays when a surge unit dies (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
