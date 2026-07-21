// Automated validation for economy.leak-integrity: a unit that grounds out at the Collector
// costs the player its leak value in Grid Integrity (a Slug leaks 2).
//
// A Slug is released with no towers to stop it; when it reaches the Collector the integrity
// must fall by exactly the Slug's leak value.
//
// Opening the run and releasing the Slug are control ops (the arrange). The walk to the
// Collector is the behavior under test, so it is the act — which also retires the old
// arrangement, where a real-time clip of the Slug crawling was filmed and then the SAME walk
// was re-run under instant stepping to decide the verdict. One implementation now does both:
// the record pass films the crawl, the validate pass steps it.

import { startBuild, spawnControlled, snap, SECOND } from "../_helpers.mjs";

// 150 s of game time = 9000 ticks, polled every 0.5 s = 30 ticks. The poll stays coarse because
// integrity is constant between leaks — nothing read here changes in between.
const WALK_TICKS = 150 * SECOND;
const POLL_TICKS = 0.5 * SECOND;

export default function item() {
  // The integrity before and after the leak, and whether the Slug ever got there.
  let i0;
  let i1;
  let reached;

  return {
    id: "economy.leak-integrity",

    async arrange(api) {
      await startBuild(api);
      await api.call("setIntegrity", 50);
      i0 = (await snap(api)).integrity;
      await spawnControlled(api, "slug");
    },

    async act(api) {
      const r = await api.until((s) => s.integrity < i0 || s.screen !== "playing", {
        max: WALK_TICKS,
        poll: POLL_TICKS,
      });
      reached = r.hit;
      i1 = (await snap(api)).integrity;
    },

    async assert(api, check) {
      check.expectOk("the Slug reached the Collector", reached);
      check.expectEq("the leak cost the Slug's leak value (2 Grid Integrity)", i0 - i1, 2);
    },
  };
}
