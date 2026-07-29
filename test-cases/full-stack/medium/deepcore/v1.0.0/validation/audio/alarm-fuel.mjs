// Automated validation for audio.alarm-fuel: a low-fuel alarm loops while fuel is under 20% of
// the tank underground (src/audio.ts's "alarm-fuel" LoopCue, started via `game.activeLoops` in
// updateLoops — src/game.ts). Audio is read from the Web Audio sources the build starts (see
// `api.audio`). We set fuel well under the warning threshold on a grounded, underground miner
// (as fuel.low-warning arranges) and step the real sim one beat so `activeLoops` recomputes,
// reading the audio log across it.

import {
  teleportInto,
  newRun,
  solid,
  ROCKBED_ROW,
  SPAWN_COL,
  armAudio,
  audioCount,
  awaitCue,
} from "../_helpers.mjs";

export default function item() {
  const col = SPAWN_COL;
  const row = ROCKBED_ROW;
  let before;
  let after;
  let snap;

  return {
    id: "audio.alarm-fuel",

    // A grounded underground miner with its tank set well under the warning threshold.
    async arrange(api) {
      await newRun(api);
      await teleportInto(api, col, row);
      await solid(api, col, row + 1);
      await teleportInto(api, col, row);
      const max = (await api.snapshot()).miner.maxFuel;
      await api.call("setFuel", max * 0.12); // well under the 20% warning threshold
      await armAudio(api);
    },

    async act(api) {
      before = await audioCount(api);
      // A couple of real fixed steps so the live-play update recomputes the warning condition (it
      // is not evaluated by `setFuel` itself).
      await api.advance(2);
      snap = (await api.snapshot()).miner;
      // Wait for the alarm rather than reading once after a fixed drain: the warning may be a
      // continuous looping source OR a repeating beep spaced over a second apart, and only a
      // polled wait sees both. See `awaitCue`.
      after = await awaitCue(api, before);
    },

    async assert(api, check) {
      check.expectOk(
        "fuel is under the 20% warning threshold",
        snap.fuel / snap.maxFuel < 0.2,
      );
      check.expectGt(
        "a low-fuel alarm loops under 20% (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
