// Automated validation for economy.overload-at-zero: when Grid Integrity is driven to 0 by a
// leak the run overloads and ends (the Overload/defeat screen), even mid-wave.
//
// Integrity is set to 1 and a Slug (leak 2) released; when it grounds out integrity falls below
// zero and the run overloads.
//
// WHERE THE CLIP SITS. The old script filmed the Slug's whole crawl from the Entry, which runs
// well over a minute — so the recording budget was spent somewhere in the middle of the yard
// and neither the escape nor the Overload screen was ever on screen. The crawl is skipped
// instead (instant in both passes, so the verdict is untouched) and the window opens with the
// Slug on the Collector's doorstep, so the clip is the ground-out, the last of the Grid
// Integrity going, and the defeat screen coming up.

import {
  startBuild,
  spawnControlled,
  skipUntilNearCollector,
  snap,
  TICK,
  SECOND,
} from "../_helpers.mjs";

// The last few metres, the leak, and the overload it causes.
const OVERLOAD_TICKS = 30 * SECOND;
// A beat on the defeat screen so it is readable in the clip.
const TAIL_TICKS = 2 * SECOND;

export default function item() {
  // Whether the overload happened, and the screen it left behind.
  let arrived;
  let overloaded;
  let screen;

  return {
    id: "economy.overload-at-zero",

    async arrange(api) {
      await startBuild(api);
      await api.call("setIntegrity", 1);
      const [slug] = await spawnControlled(api, "slug");
      arrived = await skipUntilNearCollector(api, slug.id);
    },

    async act(api) {
      const r = await api.until((s) => s.screen === "overload", {
        max: OVERLOAD_TICKS,
        poll: TICK,
      });
      overloaded = r.hit;
      screen = (await snap(api)).screen;

      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectOk("the Slug walked the chain to the Collector", arrived.hit);
      check.expectOk("the run overloaded when Grid Integrity hit zero", overloaded);
      check.expectEq("the screen is the Overload (defeat) screen", screen, "overload");
    },
  };
}
