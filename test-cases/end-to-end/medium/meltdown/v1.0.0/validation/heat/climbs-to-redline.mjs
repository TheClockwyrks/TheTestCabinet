// Automated validation for the Heat sub-item `climbs-to-redline`.
//
// An emitter's heat damage multiplier climbs on an accelerating curve to 3.5x at
// its per-tower redline (specs/heat.md). Heat is posed across the range as a
// precondition and the real damage curve's multiplier is read back at each step; it
// must rise monotonically and reach ~3.5 at the redline. The Arc's redline is 80.

import { newGame, build, tower, actTail } from "../_helpers.mjs";

const HEATS = [0, 20, 40, 60, 80];

export default function item() {
  let towerId;
  const mults = [];

  return {
    id: "heat.climbs-to-redline",

    // Five held steps of the ramp plus a beat at the redline. See CLIP_HEADROOM_MS
    // in _helpers.
    clipMs: 8000,

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      towerId = await build(api, "arc", 6, 20);
    },

    // Walk the emitter up the heat range and read the real damage curve's multiplier
    // at each stop. The old script's clip tail filmed a DIFFERENT scenario (an emitter
    // heating under fire); per the contract the clip shows what the assertions drove,
    // which is this sweep — and it reads visually too, as the tower's glow ramping
    // from cold to redline.
    //
    // Each stop is held, and there is a beat at the end, because otherwise this item
    // films NOTHING AT ALL. `setHeat` and a snapshot read are both instant, so the
    // whole sweep used to resolve inside a single frame and the recording amounted to
    // the browser's blank page before the build's first paint — a one-second clip of
    // plain white. The holds are what give the ramp frames to exist in: five steps of
    // glow, and then a beat on the redlined tower.
    async act(api) {
      for (const h of HEATS) {
        await api.call("setHeat", towerId, h);
        mults.push((await tower(api, towerId)).heatMult);
        await actTail(api, 36); // 0.6 s on each step of the ramp
      }
      await actTail(api, 120); // 2 s on the tower at its redline
    },

    async assert(api, check) {
      check.expectClose("cold multiplier (~0.35x)", mults[0], 0.35, 0.02);
      check.expectClose(
        "multiplier at the redline (~3.5x)",
        mults[4],
        3.5,
        0.02,
      );
      for (let i = 1; i < mults.length; i += 1) {
        check.expectGt(
          `heat ${HEATS[i]} multiplies harder than heat ${HEATS[i - 1]}`,
          mults[i],
          mults[i - 1],
        );
      }
    },
  };
}
