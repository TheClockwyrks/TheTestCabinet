// ink.cooldown: releasing ink starts an ~8 s cooldown before it can be used again.
//
// Entering play and clearing the cooldown is instant (`arrange`); using the ink and
// waiting the ~8 s out is the check itself, so it is `act` — and the clip opens on it
// (the record pass films the start of the wait and stops on its budget, which cannot
// affect the verdict the validate pass already decided).
import { startPlaying, INK_COOLDOWN, ticksFor } from "../_helpers.mjs";

export default function item() {
  let readyBefore;
  let s1;
  let readyAfter;

  return {
    id: "ink.cooldown",

    async arrange(api) {
      await startPlaying(api);
      await api.call("clearCooldowns");
    },

    async act(api) {
      readyBefore = (await api.snapshot()).ink.ready;
      await api.call("press", "ShiftLeft");
      // 2 ticks for the old step(0.02) = 2.4 ticks: a "one moment later" beat so the
      // cooldown has been armed, not a measured duration.
      await api.advance(2);
      s1 = await api.snapshot();
      await api.advance(ticksFor(INK_COOLDOWN)); // 960 ticks = the 8 s cooldown
      readyAfter = (await api.snapshot()).ink.ready;
    },

    async assert(api, check) {
      check.expectOk("ink is ready before use", readyBefore);
      check.expectOk(
        "ink is on cooldown right after use",
        s1.ink.ready === false,
      );
      check.expectClose(
        "the ink cooldown is ~8 s",
        s1.ink.cooldown,
        INK_COOLDOWN,
        0.4,
      );
      check.expectOk("ink is ready again after the cooldown", readyAfter);
    },
  };
}
