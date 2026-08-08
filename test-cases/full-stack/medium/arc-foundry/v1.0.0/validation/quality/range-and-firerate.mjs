// Automated validation for quality.range-and-firerate: range nudges up a little per tier
// (about 8 px per rung) while fire rate is flat across quality.
//
// One capacitor candidate is placed at each tier; each candidate's derived range must equal
// base + 8*(tier-1), and its fire rate must be the flat base value for every tier.
//
// WHAT IS FILMED, AND WHY THIS IS NO LONGER A STILL. The evidence used to be one frame of five
// candidates side by side, with whichever piece the last placement left selected showing its
// stats. The claim is a pair of comparisons ACROSS the five rungs — one figure creeping up, the
// other not moving at all — and a frame showing one rung's numbers cannot carry either of them.
// The flat fire rate in particular is a claim that a number does NOT change, which is unreadable
// from a single reading of it.
//
// So the act builds the ladder a beat at a time and then walks it, selecting each piece in turn:
// the selection also lights that piece's range ring on the yard (`specs/controls.md`), so the
// clip shows five rings widening by one rung each while the rate reading beside them holds still.
//
// Only the opening of the run is arranged; landing the five tiers and inspecting them are all
// control ops, so they are the act.

import { startBuild, placeCandidate, readPanel, SPOTS, BASE, RANGE_PER_TIER, towerAt, snap, SECOND } from "../_helpers.mjs";

// A beat between placements, so each tier lands and reads as its own piece.
const PLACE_TICKS = 0.4 * SECOND;
// How long each tier's inspector reading and range ring are held on.
const INSPECT_TICKS = 0.8 * SECOND;

export default function item() {
  // The board with the five tiers on it, read by `assert`.
  let s;

  return {
    id: "quality.range-and-firerate",

    async arrange(api) {
      await startBuild(api);
    },

    async act(api) {
      for (let tier = 1; tier <= 5; tier += 1) {
        await placeCandidate(api, "capacitor", tier, SPOTS[tier - 1].col, SPOTS[tier - 1].row);
        await api.advance(PLACE_TICKS);
      }
      s = await snap(api);

      // The press re-arms after a placement, and a held rock replaces the inspector entirely
      // (`specs/instrumentation.md`) — so the hand is emptied before anything is selected.
      await api.call("rightClick", 640, 400);
      for (let tier = 1; tier <= 5; tier += 1) {
        const t = towerAt(s, SPOTS[tier - 1].col, SPOTS[tier - 1].row);
        if (!t) continue;
        await api.call("select", t.id);
        // Wait for the panel to have been DRAWN rather than for a fixed pause: the inspector is
        // painted, and a headless browser can throttle its frame loop.
        await readPanel(api);
        await api.advance(INSPECT_TICKS);
      }
    },

    async assert(api, check) {
      for (let tier = 1; tier <= 5; tier += 1) {
        const t = towerAt(s, SPOTS[tier - 1].col, SPOTS[tier - 1].row);
        check.expectEq(`capacitor T${tier} range (base + 8/tier)`, t.range, BASE.capacitor.range + RANGE_PER_TIER * (tier - 1));
        check.expectClose(`capacitor T${tier} fire rate is flat`, t.fireRate, BASE.capacitor.fireRate, 1e-6);
      }
    },
  };
}
