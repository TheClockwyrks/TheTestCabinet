// Automated validation for states.overload: driving Grid Integrity to 0 reaches the Overload
// (defeat) screen.
//
// Posing the integrity, releasing the Slug and walking it to the Collector's doorstep are the
// arrange; the ground-out and the defeat screen it reaches are the behavior under test and are
// the act.
//
// The walk used to be filmed. A Slug's crawl to the Collector takes about 89 s, so the record
// pass needed a `clipMs` of 135000 just to reach the `screenshot` at the end — two and a quarter
// minutes of recording to capture one still, and if anything about the build made the crawl
// slower the budget ran out and the declared output never landed at all. Skipping the crawl
// (instant in both passes) reaches the same state, decides the same verdict, and leaves the
// still to be taken a couple of seconds in.

import {
  startBuild,
  spawnControlled,
  skipUntilNearCollector,
  snap,
  TICK,
  SECOND,
} from "../_helpers.mjs";

const OVERLOAD_TICKS = 30 * SECOND;
// A beat on the defeat screen before the still, so it has drawn.
const SETTLE_TICKS = 1 * SECOND;

export default function item() {
  // Whether the overload happened, and the screen it left behind.
  let arrived;
  let overloaded;
  let screen;

  return {
    id: "states.overload",

    async arrange(api) {
      await startBuild(api);
      await api.call("setIntegrity", 1);
      const [slug] = await spawnControlled(api, "slug"); // leak 2 -> integrity below zero
      arrived = await skipUntilNearCollector(api, slug.id);
    },

    async act(api) {
      const r = await api.until((s) => s.screen === "overload", {
        max: OVERLOAD_TICKS,
        poll: TICK,
      });
      overloaded = r.hit;
      screen = (await snap(api)).screen;

      await api.advance(SETTLE_TICKS);
      await api.screenshot("overload");
    },

    async assert(api, check) {
      check.expectOk("the Slug walked the chain to the Collector", arrived.hit);
      check.expectOk("the run overloads (defeat)", overloaded);
      check.expectEq("the Overload screen shows", screen, "overload");
    },
  };
}
