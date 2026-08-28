// sonar.wavefront: a pulse is a wavefront that advances outward, not an instant circle.
//
// Entering play and clearing the cooldown is instant (`arrange`); the four readings that
// track the front outward are the measurement, so they are `act` — and the clip is the
// front actually travelling.
import { startPlaying } from "../_helpers.mjs";

export default function item() {
  const fronts = [];

  return {
    id: "sonar.wavefront",

    async arrange(api) {
      await startPlaying(api);
      await api.call("clearCooldowns");
    },

    async act(api) {
      await api.call("press", "Space");
      for (let i = 0; i < 4; i++) {
        await api.advance(12); // 12 ticks = the old 0.1 s
        const p = (await api.snapshot()).pulses.find(
          (q) => q.source === "forager",
        );
        fronts.push(p ? p.front : -1);
      }
      await api.advance(108); // 108 ticks = the old 900 ms live tail
    },

    async assert(api, check) {
      check.expectOk("a forager pulse is in flight", fronts[0] >= 0);
      check.expectGt(
        "the wavefront advances outward over time (near-to-far)",
        fronts[3],
        fronts[0],
      );
      check.expectGt(
        "the front travels several tiles, not an instant circle",
        fronts[3],
        2,
      );
    },
  };
}
