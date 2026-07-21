// Automated validation for quality.auto-resolve-prefers-fresh: an un-targeted combine prefers
// consuming a fresh candidate over a standing tower.
//
// Two matching standing towers are built over two levels; a matching fresh candidate is then
// placed and an un-targeted combine committed from one standing tower. It must consume the
// FRESH candidate (which hardens into a blocker) and leave the OTHER standing tower intact.
//
// Only Level 1's placement and keep can be arranged; from the first wave onward the script
// depends on waves ENDING, which consumes time. So both clears, the second level's build, the
// fresh candidate and the auto-resolved combine all live in `act` — placements, keeps and
// combines are control ops, legal mid-act, and the run is never reset in between.

import { startBuild, placeCandidate, towerAt, snap, actClearWave, SECOND } from "../_helpers.mjs";

// A frame for the still, so the capture shows the board the assertions read. 100 ms = 6 ticks.
const SETTLE_TICKS = 6;

export default function item() {
  // The initiator, and the board after the auto-resolved combine.
  let aId;
  let s;

  return {
    id: "quality.auto-resolve-prefers-fresh",

    // The still this item declares is the board after two waves clear, which takes ~17
    // s of real play — far past the 8 s default record budget, so the record pass would
    // unwind before `screenshot` ever ran and the declared output would never land. The
    // item declares no video, so this lengthens only the record pass, not any media it
    // produces.
    clipMs: 30000,

    async arrange(api) {
      await startBuild(api);
      await api.call("setIntegrity", 999);

      // Level 1: a standing capacitor@3 (A), near the Entry so its wave clears quickly.
      const a = await placeCandidate(api, "capacitor", 3, 2, 7);
      aId = a.id;
      await api.call("keep", a.id);
    },

    async act(api) {
      await actClearWave(api, { maxTicks: 200 * SECOND });

      // Level 2: a second standing capacitor@3 (B).
      const b = await placeCandidate(api, "capacitor", 3, 6, 7);
      await api.call("keep", b.id);
      await actClearWave(api, { maxTicks: 200 * SECOND });

      // Level 3: a fresh matching candidate (C), then an un-targeted combine from A.
      await placeCandidate(api, "capacitor", 3, 10, 7);
      await api.call("setCombineSet", []); // no explicit set → auto-resolve
      await api.call("combine", aId);

      s = await snap(api);

      await api.advance(SETTLE_TICKS);
      await api.screenshot("fresh");
    },

    async assert(api, check) {
      check.expectEq("the initiator climbed a tier (A -> T4)", towerAt(s, 2, 7).quality, 4);
      check.expectEq("the fresh candidate was consumed (its footprint is now a blocker)", towerAt(s, 10, 7).kind, "blocker");
      check.expectEq("the OTHER standing tower was left intact (fresh preferred over standing)", towerAt(s, 6, 7).kind, "component");
      check.expectEq("...still at its original tier", towerAt(s, 6, 7).quality, 3);
    },
  };
}
