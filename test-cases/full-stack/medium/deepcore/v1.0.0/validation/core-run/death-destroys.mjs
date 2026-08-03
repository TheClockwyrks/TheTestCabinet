// Automated validation for core-run.death-destroys.
//
// A death while carrying the Core Sample destroys it regardless of mode. We carry the Sample, cause
// a hull death, and confirm the Sample is gone on the Game Over screen.

import {
  newRun,
  arrangeKillByHull,
  actKillByHull,
  SPAWN_COL,
  ROCKBED_ROW,
} from "../_helpers.mjs";

export default function item() {
  let carried;
  let r;

  return {
    id: "core-run.death-destroys",

    // A grounded miner underground over a gas pocket, carrying a live Sample, on a sliver of hull —
    // the death itself is produced by the real detonation when time runs forward in `act`. Posing
    // it with `setHull(0)` and waiting, as this used to, asks the build to treat a debug write as
    // the death event; see `arrangeKillByHull` for why that is not what the instrumentation spec
    // promises, and why two independent builds simply sat underground at zero hull instead.
    async arrange(api) {
      await newRun(api);
      await arrangeKillByHull(api, SPAWN_COL, ROCKBED_ROW);
      await api.call("spawnCoreSample");
      carried = (await api.snapshot()).satchel.coreSample;
    },

    // The death resolving IS the behavior, so it is what the clip shows — but what this item
    // asserts is that the SAMPLE goes with it, and that only reads if the Sample was visibly there
    // first. The opening beat holds the carried Sample and its running countdown on the HUD before
    // anything happens to the miner; `actKillByHull` then rests on the Game Over screen, where the
    // satchel no longer has it.
    async act(api) {
      await api.advance(60); // 60 ticks = 1 s with the Sample carried and its timer counting
      r = { snap: await actKillByHull(api) };
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
