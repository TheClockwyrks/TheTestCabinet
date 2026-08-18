// controls.sonar-key: Space emits a sonar pulse when ready.
//
// Entering play and clearing the cooldown is instant (`arrange`); the keypress and the
// pulse it puts in flight are `act`, so the clip shows the ping go out.
import { startPlaying } from "../_helpers.mjs";

export default function item() {
  let before;
  let forager;

  return {
    id: "controls.sonar-key",

    async arrange(api) {
      await startPlaying(api);
      await api.call("clearCooldowns");
    },

    async act(api) {
      before = (await api.snapshot()).pulses.filter(
        (p) => p.source === "forager",
      ).length;
      await api.call("press", "Space");
      await api.advance(6); // 6 ticks = the old 0.05 s
      const s = await api.snapshot();
      forager = s.pulses.filter((p) => p.source === "forager");
      await api.advance(108); // 108 ticks = the old 900 ms live tail
    },

    async assert(api, check) {
      check.expectGt(
        "Space emits a forager sonar pulse",
        forager.length,
        before,
      );
      check.expectEq(
        "the pulse is the forager's cyan ping",
        (forager[0] || {}).tint,
        "cyan",
      );
    },
  };
}
