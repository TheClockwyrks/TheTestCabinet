// Automated validation for enemies.filament-every-fourth: the Filament contingent appears only
// on waves that are a multiple of four, and never otherwise.
//
// The run is progressed naturally through Waves 1..4 (each cleared by a strong entry-adjacent
// tower), and each live wave is watched for a Filament. Waves 1-3 must produce none; Wave 4
// must produce one — this reads the REAL, naturally-composed wave, not a fabricated spawn.

import { startBuild, placeCandidate, snap, stepUntil, clearWave } from "../_helpers.mjs";

const SPOTS = [
  [2, 7],
  [6, 7],
  [10, 7],
  [2, 10],
];

export default async function drive(api, ttc) {
  const check = ttc.checkOne("enemies.filament-every-fourth");

  await startBuild(api, { difficulty: "easy" });
  await api.call("setIntegrity", 999);

  let filamentBeforeFour = false;
  let filamentOnFour = false;

  for (let level = 1; level <= 4; level += 1) {
    const [c, r] = SPOTS[level - 1];
    const cand = await placeCandidate(api, "capacitor", 3, c, r); // strong: clears the wave fast
    await api.call("keep", cand.id); // launches this level's wave

    // Watch the live wave until a Filament appears or it clears.
    const res = await stepUntil(
      api,
      (s) => s.units.some((u) => u.type === "filament") || s.phase === "build" || s.screen !== "playing",
      120,
      0.25,
    );
    const hasFilament = res.snap.units.some((u) => u.type === "filament");
    if (level < 4 && hasFilament) filamentBeforeFour = true;
    if (level === 4 && hasFilament) filamentOnFour = true;

    await clearWave(api, 120); // finish the wave to reopen the build phase
  }

  check.expectOk("no Filament appears on Waves 1-3", !filamentBeforeFour);
  check.expectOk("a Filament appears on Wave 4", filamentOnFour);

  await api.screenshot("flyer");
  return check.verdict();
}
