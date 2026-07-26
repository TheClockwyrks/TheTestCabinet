// Automated validation for quality.plain-combine-midwave: a plain COMBINE of only standing
// towers is allowed during a live wave, climbs their quality, and does NOT restart the wave.
//
// Two standing capacitors are built over two levels; the second keep launches Wave 2 (live).
// During that live wave the two standing towers are combined — the phase stays "wave", the
// result climbs a tier, and the partner hardens into a blocker.
//
// Only Level 1's placement and keep can be arranged; reaching the LIVE Wave 2 requires Wave 1
// to end, which consumes time. So the clear, the second level's build and keep, and the
// mid-wave combine are all the act — which is exactly the clip this item wants: a wave running,
// two standing towers folding into one, and the wave carrying on uninterrupted.

import { startBuild, placeCandidate, towerAt, snap, actClearWave, SECOND } from "../_helpers.mjs";

// After the fold, long enough for the still-live wave to visibly keep running — that is what
// "without restarting the wave" looks like on screen.
const CLIP_TICKS = 2 * SECOND;

export default function item() {
  // The initiator, the board when Wave 2 went live, and the board after the mid-wave fold.
  let aId;
  let live;
  let s;

  return {
    id: "quality.plain-combine-midwave",

    async arrange(api) {
      await startBuild(api);
      await api.call("setIntegrity", 999);

      const a = await placeCandidate(api, "capacitor", 3, 2, 7);
      aId = a.id;
      await api.call("keep", a.id); // Wave 1
    },

    async act(api) {
      await actClearWave(api, { maxTicks: 200 * SECOND });

      const b = await placeCandidate(api, "capacitor", 3, 6, 7);
      await api.call("keep", b.id); // Wave 2 — now LIVE
      live = await snap(api);

      // Combine the two STANDING towers during the live wave.
      await api.call("setCombineSet", [aId, b.id]);
      await api.call("combine", aId);
      s = await snap(api);

      await api.advance(CLIP_TICKS);
    },

    async assert(api, check) {
      check.expectEq("a wave is live", live.phase, "wave");
      check.expectEq("the standing combine produced a higher tier", towerAt(s, 2, 7).quality, 4);
      check.expectEq("...without restarting the wave (still live)", s.phase, "wave");
      check.expectEq("the partner hardened into a blocker", towerAt(s, 6, 7).kind, "blocker");
    },
  };
}
