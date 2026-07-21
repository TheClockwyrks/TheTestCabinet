// Automated validation for build.keep-one-harvest: KEEPing a candidate takes exactly one
// firing component off the level, hardens every other candidate into a blocker, and launches
// the wave (there is no SEND).
//
// Dropping the three candidates is all control ops (the arrange). The KEEP is the behavior
// under test, so it is the act — and since the harvest launches the wave, the clip carries on
// into that wave, which is one of the things asserted.

import { startBuild, placeCandidate, towerAt, snap, SECOND } from "../_helpers.mjs";

// How much of the launched wave to show after the harvest. Two seconds is enough for the first
// units to walk in, which is what "the harvest launched the wave" looks like on screen.
const WAVE_TICKS = 2 * SECOND;

export default function item() {
  // The candidate that gets kept, and the board before and after the harvest.
  let keepId;
  let before;
  let s;

  return {
    id: "build.keep-one-harvest",

    async arrange(api) {
      await startBuild(api);
      const a = await placeCandidate(api, "capacitor", 1, 6, 7);
      keepId = a.id;
      await placeCandidate(api, "coil", 1, 10, 7);
      await placeCandidate(api, "emitter", 1, 14, 7);
    },

    async act(api) {
      before = await snap(api);

      await api.call("keep", keepId);
      s = await snap(api);

      // The assertions are already fixed on `s`; this only lets the clip depict the wave the
      // harvest launched.
      await api.advance(WAVE_TICKS);
    },

    async assert(api, check) {
      check.expectEq("three candidates are placed", before.towers.filter((t) => t.kind === "candidate").length, 3);
      check.expectEq("the kept candidate became a firing component", towerAt(s, 6, 7).kind, "component");
      check.expectEq("an un-kept candidate hardened into a blocker", towerAt(s, 10, 7).kind, "blocker");
      check.expectEq("the other un-kept candidate hardened into a blocker", towerAt(s, 14, 7).kind, "blocker");
      check.expectEq("no candidates remain (exactly one was harvested)", s.towers.filter((t) => t.kind === "candidate").length, 0);
      check.expectEq("the harvest launched the wave (there is no SEND)", s.phase, "wave");
    },
  };
}
