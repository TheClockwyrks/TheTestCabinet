// Automated validation for the Surge sub-item `single-type-waves`.
//
// Each wave releases a single intruder type (specs/surge.md), so every wave presses
// one specific answer instead of a mixture the player meets all at once. For a spread
// of waves across a Medium run we read the build-phase preview of the coming wave,
// which lists the distinct types it will field, and require exactly one. A preview
// alone could be satisfied by a build that advertises one type and then spawns a mix,
// so we also release two of those waves and confirm every unit that actually spawns is
// the single previewed type. Across the run the waves must not all be the same type —
// the roster cycles, so each wave presses a different answer.

import { newGame, liveClip } from "../_helpers.mjs";

// A spread across the run: the opening waves, the ones where the roster is still being
// introduced, and a couple past the midpoint. All are non-milestone waves (the
// milestone Core waves are covered by `surge.milestone-core`).
const WAVES = [1, 3, 4, 5, 8, 9, 11];

// The distinct types the coming wave will field, as the build panel previews them.
async function preview(api, wave) {
  await api.call("setWave", wave);
  const s = await api.snapshot();
  return Array.isArray(s.wavePreview) ? s.wavePreview : [];
}

// Release `wave` and collect every distinct type that actually spawns over `seconds`
// of real simulation. Nothing is built, so units simply walk the empty floor and leak;
// lives are posed high enough that the run cannot end mid-sample.
async function spawnedTypes(api, wave, seconds = 14) {
  await api.call("setWave", wave);
  await api.call("startWave");
  const seen = new Set();
  for (let t = 0; t < seconds; t += 0.5) {
    await api.step(0.5);
    for (const u of (await api.snapshot()).surge) seen.add(u.type);
  }
  return [...seen];
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("surge.single-type-waves");

  await newGame(api, "containment", "medium", 100000);
  await api.call("setLives", 1000000);

  const previewed = [];
  for (const w of WAVES) {
    const types = await preview(api, w);
    check.expectEq(
      `wave ${w} previews exactly one intruder type (saw ${types.join(", ") || "none"})`,
      types.length,
      1,
    );
    if (types.length === 1) previewed.push(types[0]);
  }

  check.expectGt(
    `the waves checked are not all one type (saw ${previewed.join(", ") || "none"})`,
    new Set(previewed).size,
    1,
  );

  // Spot-check that what actually spawns is the single previewed type.
  for (const w of [4, 8]) {
    const want = await preview(api, w);
    const got = await spawnedTypes(api, w);
    check.expectEq(
      `wave ${w} spawns exactly one intruder type (saw ${got.join(", ") || "none"})`,
      got.length,
      1,
    );
    if (want.length === 1 && got.length === 1) {
      check.expectEq(`wave ${w} spawns the previewed ${want[0]}`, got[0], want[0]);
    }
  }

  await liveClip(api, 2000);
  return check.verdict();
}
