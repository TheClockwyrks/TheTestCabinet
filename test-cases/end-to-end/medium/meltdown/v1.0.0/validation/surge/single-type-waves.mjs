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

import { newGame, actTail } from "../_helpers.mjs";

// A spread across the run: the opening waves, the ones where the roster is still being
// introduced, and a couple past the midpoint. All are non-milestone waves (the
// milestone Core waves are covered by `surge.milestone-core`).
const WAVES = [1, 3, 4, 5, 8, 9, 11];

// The waves that are additionally released and watched, to prove the preview is not
// just an advertisement.
const RELEASED = [4, 8];

// The distinct types the coming wave will field, as the build panel previews them.
// `setWave` only poses the wave counter, so this consumes no time.
async function preview(api, wave) {
  await api.call("setWave", wave);
  const s = await api.snapshot();
  return Array.isArray(s.wavePreview) ? s.wavePreview : [];
}

// The old sampler ran 14s in 0.5s slices; 30 ticks = 0.5s, so 28 slices of 30 ticks
// cover the same 840 ticks. Sampling in slices (rather than one long advance) is the
// point — a mixed wave could field its second type at any moment in the window, and
// only a repeated read would catch it.
//
// The slices are SKIPPED rather than advanced. The sampling has to cover the whole
// window to be sound, but a reviewer does not have to sit through two of them: at
// real time this was half a minute of clip, most of it an empty floor between spawns,
// and it crowded out the one thing worth seeing. The verdict is unchanged — a skipped
// slice steps the same real simulation and reads the same snapshot — and `act` films
// a beat of the last released wave in flight instead.
const SLICE_TICKS = 30;
const SLICES = 28;

// Release `wave` and collect every distinct type that actually spawns. Nothing is
// built, so units simply walk the empty floor and leak; lives are posed high enough
// that the run cannot end mid-sample.
//
// Only units THIS wave spawns are evidence about this wave. An earlier release
// sampled here can still have units walking the floor — a volume wave fields dozens,
// and `setWave` poses the run's progression without clearing the surge — so every
// unit already out there is recorded first and ignored. Counting the floor wholesale
// instead reports a single-type wave as a mixture, failing a build that spawned
// exactly one type, and it does so only for the LATER wave sampled, which is what
// makes the mistake look like a real per-wave bug.
async function spawnedTypes(api, wave) {
  await api.call("setWave", wave);
  const carriedOver = new Set((await api.snapshot()).surge.map((u) => u.id));
  await api.call("startWave");
  const seen = new Set();
  for (let i = 0; i < SLICES; i += 1) {
    await api.skip(SLICE_TICKS);
    for (const u of (await api.snapshot()).surge) {
      if (!carriedOver.has(u.id)) seen.add(u.type);
    }
  }
  return [...seen];
}

export default function item() {
  const previewed = [];
  const previews = [];
  const released = [];

  return {
    id: "surge.single-type-waves",

    // The sampling is skipped; only a beat of the last released wave is filmed.
    clipMs: 5500,

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 1000000);
    },

    // Read every preview, then release two of those waves and watch what actually
    // comes out of the vents. Note nothing here needs a fresh match: `setWave` poses
    // the counter in place, so no `reset` (and no `restartGame`) is involved.
    async act(api) {
      for (const w of WAVES) {
        const types = await preview(api, w);
        previews.push({ wave: w, types });
        if (types.length === 1) previewed.push(types[0]);
      }

      // Spot-check that what actually spawns is the single previewed type.
      for (const w of RELEASED) {
        const want = await preview(api, w);
        const got = await spawnedTypes(api, w);
        released.push({ wave: w, want, got });
      }

      // The sampling above is skipped, so this is the only filmed part: a beat of the
      // last released wave still on the floor, one intruder type across the whole of
      // it. That is what the item claims, and it is legible in a few seconds.
      await actTail(api, 180);
    },

    async assert(api, check) {
      for (const { wave, types } of previews) {
        check.expectEq(
          `wave ${wave} previews exactly one intruder type (saw ${types.join(", ") || "none"})`,
          types.length,
          1,
        );
      }

      check.expectGt(
        `the waves checked are not all one type (saw ${previewed.join(", ") || "none"})`,
        new Set(previewed).size,
        1,
      );

      for (const { wave, want, got } of released) {
        check.expectEq(
          `wave ${wave} spawns exactly one intruder type (saw ${got.join(", ") || "none"})`,
          got.length,
          1,
        );
        if (want.length === 1 && got.length === 1) {
          check.expectEq(
            `wave ${wave} spawns the previewed ${want[0]}`,
            got[0],
            want[0],
          );
        }
      }
    },
  };
}
