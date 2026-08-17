// Automated validation for quality.damage-scales: a component's damage multiplies
// x1 / x3 / x9 / x40 / x110 over Scrap across the five tiers — quality is the power axis.
//
// One capacitor candidate is placed at each tier; each candidate reports its derived damage,
// which must equal the base (Scrap) damage times the tier multiplier.
//
// WHAT IS FILMED, AND WHY THIS IS NO LONGER A STILL. The evidence used to be one frame of five
// candidates standing side by side, with whichever piece the last placement happened to leave
// selected showing its stats in the inspector. That is a picture of ONE tier's damage — the check
// reads five numbers and the reviewer was shown one of them, with no way to see the other four or
// the ratios between them, which is the entire claim. A ladder is a comparison, and a comparison
// needs every rung.
//
// So the act builds the ladder a beat at a time and then walks it: each of the five pieces is
// selected in turn and held on long enough for the inspector's damage reading to be read off
// screen. The clip is then the figure climbing x1 → x3 → x9 → x40 → x110, which is what the
// assertions check, in the order they check it.
//
// Only the opening of the run is arranged; landing the five tiers and inspecting them are all
// control ops, so they are the act.

import { startBuild, placeCandidate, readPanel, SPOTS, BASE, QUALITY_MULT, towerAt, snap, SECOND } from "../_helpers.mjs";

// A beat between placements, so each tier lands and reads as its own piece.
const PLACE_TICKS = 0.4 * SECOND;
// How long each tier's inspector reading is held on. Long enough to read a number off a moving
// clip without being long enough that five of them overrun the recording budget.
const INSPECT_TICKS = 0.8 * SECOND;

export default function item() {
  // The board with the five tiers on it, read by `assert`.
  let s;

  return {
    id: "quality.damage-scales",

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
        const expected = Math.round(BASE.capacitor.dmg * QUALITY_MULT[tier]);
        check.expectEq(`capacitor T${tier} damage (x${QUALITY_MULT[tier]} over Scrap)`, t.damage, expected);
      }
    },
  };
}
