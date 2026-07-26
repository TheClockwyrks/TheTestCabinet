// ink.cloud: an ink cloud is ~80 px in radius, lingers ~3 s, and stays fixed in place.
//
// Entering play and clearing the cooldown is instant (`arrange`); releasing the cloud and
// letting it linger is the real sim, so it is `act` — the clip is the cloud sitting where
// it was dropped while its life burns down.
import { startPlaying, INK_RADIUS, INK_LIFE } from "../_helpers.mjs";

export default function item() {
  let c0;
  let c1;

  return {
    id: "ink.cloud",

    async arrange(api) {
      await startPlaying(api);
      await api.call("clearCooldowns");
    },

    async act(api) {
      await api.call("press", "ShiftLeft");
      // 2 ticks for the old step(0.02) = 2.4 ticks: a "one moment later" beat so the
      // cloud exists to be read, not a measured duration.
      await api.advance(2);
      c0 = (await api.snapshot()).inkClouds[0];
      await api.advance(120); // 120 ticks = the old 1.0 s of lingering
      c1 = (await api.snapshot()).inkClouds[0];
      await api.advance(96); // 96 ticks = the old 800 ms live tail
    },

    async assert(api, check) {
      check.expectOk("an ink cloud exists", Boolean(c0));
      check.expectClose("its radius is ~80 px", c0.radius, INK_RADIUS, 20);
      check.expectClose("it lingers ~3 s", c0.remaining, INK_LIFE, 0.3);
      check.expectOk(
        "the cloud stays fixed where it was released",
        Math.abs(c1.x - c0.x) < 1 && Math.abs(c1.y - c0.y) < 1,
      );
      check.expectLt(
        "its remaining lifetime decreases as it lingers",
        c1.remaining,
        c0.remaining,
      );
    },
  };
}
