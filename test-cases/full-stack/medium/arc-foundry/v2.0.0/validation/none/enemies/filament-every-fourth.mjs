// Automated validation for enemies.filament-every-fourth: the Filament contingent appears only
// on waves that are a multiple of four, and never otherwise.
//
// The run is progressed naturally through Waves 1..4 (each cleared by a strong entry-adjacent
// tower), and each live wave is watched for a Filament. Waves 1-3 must produce none; Wave 4
// must produce one — this reads the REAL, naturally-composed wave, not a fabricated spawn.
//
// WHY THE PROGRESSION IS NO LONGER FILMED. Four waves used to be walked out inside `act`, on
// `until`/`actClearWave`, which advance in REAL time in the record pass. Four waves of an
// undefended-but-for-one-tower yard is most of a minute, and the still this item declares is taken
// at the END of it — so the whole thing rested on the recording budget outlasting however fast a
// given build happens to pace its waves. The budget was raised to 60 s to cover it, which only
// moved the threshold: one run implementation still ran past it, unwound before `screenshot` ever
// ran, and was recorded as producing no output at all — which reads as a broken debug API and
// failed the point, for a build whose Filaments work.
//
// The progression is the journey to the evidence rather than the evidence, so it moves to
// `arrange` on `skip`: the same real waves, naturally composed, watched exactly as before, but
// instant in both passes. Nothing about the verdict changes — the validate pass was always
// instant. The act is then the one thing worth a picture: Wave 4 with its flyer on the floor.

import { startBuild, placeCandidate, skipClearWave, SECOND } from "../_helpers.mjs";

const SPOTS = [
  [2, 7],
  [6, 7],
  [10, 7],
  [2, 10],
];

// 120 s of game time, polled every 0.25 s — a contingent is on the floor far longer than a
// quarter second once released, so nothing can slip between samples.
const WATCH_TICKS = 120 * SECOND;
const POLL_TICKS = 0.25 * SECOND;
// A beat on the fourth wave with its flyer up, so the still is taken on a live board.
const SHOW_TICKS = 1.5 * SECOND;

export default function item() {
  // Whether a Filament turned up before Wave 4, and whether one turned up on it.
  let filamentBeforeFour = false;
  let filamentOnFour = false;

  return {
    id: "enemies.filament-every-fourth",

    async arrange(api) {
      await startBuild(api, { difficulty: "easy" });
      await api.call("setIntegrity", 999);

      for (let level = 1; level <= 4; level += 1) {
        const [c, r] = SPOTS[level - 1];
        const cand = await placeCandidate(api, "capacitor", 3, c, r); // strong: clears the wave fast
        await api.call("keep", cand.id); // launches this level's wave

        // Watch the live wave until a Filament appears or it clears.
        const res = await api.skipUntil(
          (s) => s.units.some((u) => u.type === "filament") || s.phase === "build" || s.screen !== "playing",
          { max: WATCH_TICKS, poll: POLL_TICKS },
        );
        const hasFilament = res.snap.units.some((u) => u.type === "filament");
        if (level < 4 && hasFilament) filamentBeforeFour = true;
        if (level === 4 && hasFilament) filamentOnFour = true;

        // Waves 1-3 are run out to reopen the build phase for the next level. Wave 4 is left
        // running with its flyer on the floor, which is what the act is there to show.
        if (level < 4) await skipClearWave(api, { maxTicks: 120 * SECOND });
      }
    },

    async act(api) {
      // Wave 4, live, with its Filament contingent up.
      await api.advance(SHOW_TICKS);
      await api.screenshot("flyer");
    },

    async assert(api, check) {
      check.expectOk("no Filament appears on Waves 1-3", !filamentBeforeFour);
      check.expectOk("a Filament appears on Wave 4", filamentOnFour);
    },
  };
}
