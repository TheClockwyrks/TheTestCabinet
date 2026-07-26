// controls.ink-key: Shift releases an ink cloud when ready.
//
// Entering play and clearing the cooldown is instant (`arrange`); the keypress and the
// moment the released cloud needs to exist are `act`, so the clip shows the ink go out.
import { startPlaying } from "../_helpers.mjs";

export default function item() {
  let before;
  let s;

  return {
    id: "controls.ink-key",

    async arrange(api) {
      await startPlaying(api);
      await api.call("clearCooldowns");
    },

    async act(api) {
      before = (await api.snapshot()).inkClouds.length;
      await api.call("press", "ShiftLeft");
      // 2 ticks for the old step(0.02) = 2.4 ticks: a "one moment later" beat so the
      // released cloud exists, not a measured duration, so the shorter whole tick holds.
      await api.advance(2);
      s = await api.snapshot();
      await api.advance(84); // 84 ticks = the old 700 ms live tail
    },

    async assert(api, check) {
      check.expectGt("Shift releases an ink cloud", s.inkClouds.length, before);
    },
  };
}
