// Automated validation for the Audio item `leak`: a leak alarm plays when a unit grounds
// out at the Collector. Audio is read from the Web Audio sources the build starts (see
// `api.audio`). A Slug is released with no towers to stop it, walked to the Collector's
// doorstep, and the real simulation is then stepped until it grounds out and Grid Integrity
// falls (`economy.leak-integrity`'s own precondition) — the audio log must grow across the leak.
//
// The crawl across the yard is skipped rather than filmed, for the same reason
// `economy.leak-integrity` skips it: it runs well over a minute, which is several times the
// recording budget, and the cue this item listens for is at the end of it. Audio is armed AFTER
// the skip, so the arming gesture and the settle it needs are not spent walking.

import {
  startBuild,
  spawnControlled,
  skipUntilNearCollector,
  armAudio,
  audioCount,
  waitForAudio,
  TICK,
  SECOND,
} from "../_helpers.mjs";

const LEAK_TICKS = 30 * SECOND;

export default function item() {
  let before;
  let after;
  let leaked;
  let arrived;
  let i0;

  return {
    id: "audio.leak",

    async arrange(api) {
      await startBuild(api);
      await api.call("setIntegrity", 50);
      i0 = (await api.snapshot()).integrity;
      const [slug] = await spawnControlled(api, "slug");
      arrived = await skipUntilNearCollector(api, slug.id);
      await armAudio(api);
    },

    async act(api) {
      before = await audioCount(api);
      const r = await api.until(
        (s) => s.integrity < i0 || s.screen !== "playing",
        { max: LEAK_TICKS, poll: TICK },
      );
      leaked = r.hit;
      after = await waitForAudio(api, before);
    },

    async assert(api, check) {
      check.expectOk("the Slug walked the chain to the Collector", arrived.hit);
      check.expectOk("the Slug reaches the Collector and leaks", leaked);
      check.expectGt(
        "a leak alarm plays on the leak (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
