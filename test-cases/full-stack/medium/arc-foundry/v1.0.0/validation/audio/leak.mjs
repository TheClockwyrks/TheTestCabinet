// Automated validation for the Audio item `leak`: a leak alarm plays when a unit grounds
// out at the Collector. Audio is read from the Web Audio sources the build starts (see
// `api.audio`). A Slug is released with no towers to stop it; audio is armed, and the real
// simulation is stepped until it reaches the Collector and Grid Integrity falls
// (`economy.leak-integrity`'s own precondition) — the audio log must grow across the leak.

import {
  startBuild,
  spawnControlled,
  armAudio,
  audioCount,
  AUDIO_SETTLE_MS,
  SECOND,
} from "../_helpers.mjs";

// 150 s of game time = 9000 ticks, polled every 0.5 s = 30 ticks — the same budget
// `economy.leak-integrity` uses for the same walk.
const WALK_TICKS = 150 * SECOND;
const POLL_TICKS = 0.5 * SECOND;

export default function item() {
  let before;
  let after;
  let leaked;
  let i0;

  return {
    id: "audio.leak",

    async arrange(api) {
      await startBuild(api);
      await api.call("setIntegrity", 50);
      i0 = (await api.snapshot()).integrity;
      await spawnControlled(api, "slug");
      await armAudio(api);
    },

    async act(api) {
      before = await audioCount(api);
      const r = await api.until(
        (s) => s.integrity < i0 || s.screen !== "playing",
        {
          max: WALK_TICKS,
          poll: POLL_TICKS,
        },
      );
      leaked = r.hit;
      await api.settle(AUDIO_SETTLE_MS);
      after = await audioCount(api);
    },

    async assert(api, check) {
      check.expectOk("the Slug reaches the Collector and leaks", leaked);
      check.expectGt(
        "a leak alarm plays on the leak (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
