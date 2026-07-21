// Automated validation for economy.overload-at-zero: when Grid Integrity is driven to 0 by a
// leak the run overloads and ends (the Overload/defeat screen), even mid-wave.
//
// Integrity is set to 1 and a Slug (leak 2) released; when it grounds out integrity falls
// below zero and the run overloads.
//
// Posing the integrity and releasing the Slug are control ops (the arrange); the crawl to the
// sink and the overload it causes are the behavior under test, so they are the act. The old
// script filmed that crawl and then re-ran it under instant stepping to decide the verdict; the
// two-pass runtime does both from this one act.

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
    id: "economy.overload-at-zero",

    async arrange(api) {
      await startBuild(api);
      await api.call("setIntegrity", 1);
      await spawnControlled(api, "slug");
    },

    async act(api) {
      const r = await api.until((s) => s.screen === "overload", { max: WALK_TICKS, poll: POLL_TICKS });
      overloaded = r.hit;
      screen = (await snap(api)).screen;
    },

    async assert(api, check) {
      check.expectOk("the run overloaded when Grid Integrity hit zero", overloaded);
      check.expectEq("the screen is the Overload (defeat) screen", screen, "overload");
    },
  };
}
