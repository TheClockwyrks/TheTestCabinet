// Automated validation for core-run.death-destroys.
//
// A death while carrying the Core Sample destroys it regardless of mode. We carry the Sample, cause
// a hull death, and confirm the Sample is gone on the Game Over screen.

import { newRun, standAt, SPAWN_COL, ROCKBED_ROW } from "../_helpers.mjs";

export default function item() {
  let carried;
  let r;

  return {
    id: "core-run.death-destroys",

    // A grounded miner underground, carrying a live Sample, with its hull emptied — the death
    // itself is left to the real death path when time runs forward.
    async arrange(api) {
      await newRun(api);
      await standAt(api, SPAWN_COL, ROCKBED_ROW);
      await api.call("spawnCoreSample");
      carried = (await api.snapshot()).satchel.coreSample;
      await api.call("setHull", 0);
    },

    // The death resolving IS the behavior, so it is what the clip shows.
    async act(api) {
      // 180 ticks = the old 3 s cap; poll 6 = the old 0.1 s chunk (nothing read here changes
      // before the death lands, so a coarse poll is enough).
      r = await api.until((s) => s.screen === "game-over", {
        max: 180,
        poll: 6,
      });
    },

    async assert(api, check) {
      check.expectEq("the Sample is carried before the death", carried, true);
      check.expectEq("the run ended", r.snap.screen, "game-over");
      check.expectEq(
        "the death was by hull loss, not the timer",
        r.snap.summary ? r.snap.summary.deathCause : null,
        "hull-destroyed",
      );
      check.expectEq(
        "the carried Sample is destroyed on death",
        r.snap.satchel.coreSample,
        false,
      );
    },
  };
}
