// Automated validation for states.overload: driving Grid Integrity to 0 reaches the Overload
// (defeat) screen.
//
// Posing the integrity and releasing the Slug are control ops (the arrange); the crawl that
// grounds it out and the defeat screen it reaches are the behavior under test and are the act.

import { startBuild, spawnControlled, snap, SECOND } from "../_helpers.mjs";

// 150 s of game time = 9000 ticks, polled every 0.5 s = 30 ticks — the screen is constant
// between the leak and the overload, so a coarse poll misses nothing.
const WALK_TICKS = 150 * SECOND;
const POLL_TICKS = 0.5 * SECOND;

export default function item() {
  // Whether the overload happened, and the screen it left behind.
  let overloaded;
  let screen;

  return {
    id: "states.overload",

    // The still this item declares is the Overload screen, and the Slug's crawl to the
    // Collector takes ~89 s — far past the 8 s default record budget, so the record
    // pass would unwind before `screenshot` ever ran and the declared output would
    // never land. The item declares no video, so this lengthens only the record pass,
    // not any media it produces.
    clipMs: 135000,

    async arrange(api) {
      await startBuild(api);
      await api.call("setIntegrity", 1);
      await spawnControlled(api, "slug"); // leak 2 -> integrity below zero
    },

    async act(api) {
      const r = await api.until((s) => s.screen === "overload", { max: WALK_TICKS, poll: POLL_TICKS });
      overloaded = r.hit;
      screen = (await snap(api)).screen;

      await api.screenshot("overload");
    },

    async assert(api, check) {
      check.expectOk("the run overloads (defeat)", overloaded);
      check.expectEq("the Overload screen shows", screen, "overload");
    },
  };
}
