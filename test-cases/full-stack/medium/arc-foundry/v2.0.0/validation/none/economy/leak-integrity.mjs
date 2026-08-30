// Automated validation for economy.leak-integrity: a unit that grounds out at the Collector
// costs the player its leak value in Grid Integrity (a Slug leaks 2).
//
// A Slug is released with no towers to stop it; when it reaches the Collector the integrity
// must fall by exactly the Slug's leak value.
//
// WHERE THE CLIP SITS. A Slug crawls at 38 px/s and the chain crosses the yard six times, so
// its walk to the Collector runs well over a minute — several times the recording budget. The
// old script filmed that walk from the moment of release, so the clip was a minute of crawling
// and stopped long before the leak it exists to show. The crawl is skipped instead (instant in
// both passes, so the verdict is untouched) and the window opens with the Slug on the
// Collector's doorstep, which is where the behavior happens.

import {
  startBuild,
  spawnControlled,
  skipUntilNearCollector,
  snap,
  TICK,
  SECOND,
} from "../_helpers.mjs";

// The last few metres and the leak itself, from a unit already on the doorstep.
const LEAK_TICKS = 30 * SECOND;
// A beat after the leak so the Grid Integrity change is readable on the HUD in the clip.
const TAIL_TICKS = 1.5 * SECOND;

export default function item() {
  // The integrity before and after the leak, and whether the Slug ever got there.
  let i0;
  let i1;
  let reached;
  let arrived;

  return {
    id: "economy.leak-integrity",

    async arrange(api) {
      await startBuild(api);
      await api.call("setIntegrity", 50);
      i0 = (await snap(api)).integrity;
      const [slug] = await spawnControlled(api, "slug");
      arrived = await skipUntilNearCollector(api, slug.id);
    },

    async act(api) {
      const r = await api.until((s) => s.integrity < i0 || s.screen !== "playing", {
        max: LEAK_TICKS,
        poll: TICK,
      });
      reached = r.hit;
      i1 = (await snap(api)).integrity;

      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectOk("the Slug walked the chain to the Collector", arrived.hit);
      check.expectOk("the Slug reached the Collector", reached);
      check.expectEq("the leak cost the Slug's leak value (2 Grid Integrity)", i0 - i1, 2);
    },
  };
}
