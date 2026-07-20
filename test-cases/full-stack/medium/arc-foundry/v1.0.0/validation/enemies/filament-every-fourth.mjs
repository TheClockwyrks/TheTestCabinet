// Automated validation for enemies.filament-every-fourth: the Filament contingent appears only
// on waves that are a multiple of four, and never otherwise.
//
// The run is progressed naturally through Waves 1..4 (each cleared by a strong entry-adjacent
// tower), and each live wave is watched for a Filament. Waves 1-3 must produce none; Wave 4
// must produce one — this reads the REAL, naturally-composed wave, not a fabricated spawn.
//
// Only the opening of the run is arranged. The four-level progression is all in the act: each
// level's placement and keep are control ops (legal mid-act), and the watching and clearing
// consume time. The run is never reset in between, so no phase rule is broken.

import { startBuild, placeCandidate, actClearWave, SECOND } from "../_helpers.mjs";

const SPOTS = [
  [2, 7],
  [6, 7],
  [10, 7],
  [2, 10],
];

// 120 s of game time = 7200 ticks, polled every 0.25 s = 15 ticks — the coarse cadence the old
// script used, and enough because a contingent is on the floor for far longer than a quarter
// second once it is released.
const WATCH_TICKS = 120 * SECOND;
const POLL_TICKS = 0.25 * SECOND;

export default function item() {
  // Whether a Filament turned up before Wave 4, and whether one turned up on it.
  let filamentBeforeFour = false;
  let filamentOnFour = false;

  return {
    id: "enemies.filament-every-fourth",

    // The still this item declares is the fourth wave's flyer, and progressing four
    // waves takes ~38 s of real play — far past the 8 s default record budget, so the
    // record pass would unwind before `screenshot` ever ran and the declared output
    // would never land. The item declares no video, so this lengthens only the record
    // pass, not any media it produces.
    clipMs: 60000,

    async arrange(api) {
      await startBuild(api, { difficulty: "easy" });
      await api.call("setIntegrity", 999);
    },

    async act(api) {
      for (let level = 1; level <= 4; level += 1) {
        const [c, r] = SPOTS[level - 1];
        const cand = await placeCandidate(api, "capacitor", 3, c, r); // strong: clears the wave fast
        await api.call("keep", cand.id); // launches this level's wave

        // Watch the live wave until a Filament appears or it clears.
        const res = await api.until(
          (s) => s.units.some((u) => u.type === "filament") || s.phase === "build" || s.screen !== "playing",
          { max: WATCH_TICKS, poll: POLL_TICKS },
        );
        const hasFilament = res.snap.units.some((u) => u.type === "filament");
        if (level < 4 && hasFilament) filamentBeforeFour = true;
        if (level === 4 && hasFilament) filamentOnFour = true;

        await actClearWave(api, { maxTicks: 120 * SECOND }); // finish the wave to reopen the build phase
      }

      await api.screenshot("flyer");
    },

    async assert(api, check) {
      check.expectOk("no Filament appears on Waves 1-3", !filamentBeforeFour);
      check.expectOk("a Filament appears on Wave 4", filamentOnFour);
    },
  };
}
