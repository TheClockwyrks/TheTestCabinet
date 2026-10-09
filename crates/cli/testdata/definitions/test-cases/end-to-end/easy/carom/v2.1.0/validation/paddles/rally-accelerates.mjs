// Automated validation for the Paddles sub-item `rally-accelerates`.
//
// A normal paddle hit speeds the ball up slightly (physics.md:
// `speed = min(speed * 1.04, 980)`), so a rally accelerates gradually hit by hit.
// This drives a REAL straight rally (see `actRallySpeeds`) and confirms the per-hit
// speed ratio is ~1.04 while below the ceiling and that the sequence never decreases.
// The plateau at the ceiling is the sibling `rally-caps` check.

import { arrangeRally, actRallySpeeds, SPEED_CAP } from "../_helpers.mjs";

const SPEED_MULT = 1.04;

export default function item() {
  let speeds;

  return {
    id: "paddles.rally-accelerates",

    // Two stationary, centered paddles and a ball launched level down the middle: a
    // center hit returns the ball level, so it bounces cleanly back and forth clear of
    // the obstacles and every hit is a plain, spin-free paddle contact.
    async arrange(api) {
      await arrangeRally(api);
    },

    // Play the real rally, collecting the ball's speed after each successive hit. The
    // rally IS the clip — the reviewer watches the very exchange the ratios come from,
    // visibly picking up pace hit by hit.
    async act(api) {
      speeds = await actRallySpeeds(api);
    },

    async assert(api, check) {
      // Ratios between consecutive post-hit speeds should be ~1.04 while below the cap,
      // and the sequence must never decrease hit to hit.
      let ratiosOk = speeds.length >= 12;
      let monotonic = true;
      for (let i = 1; i < speeds.length; i += 1) {
        if (speeds[i] < speeds[i - 1] - 0.5) monotonic = false;
        if (speeds[i - 1] < SPEED_CAP / SPEED_MULT - 1) {
          const ratio = speeds[i] / speeds[i - 1];
          if (Math.abs(ratio - SPEED_MULT) > 0.01) ratiosOk = false;
        }
      }

      check.expectOk(
        "each hit speeds the ball up ~1.04x below the cap",
        ratiosOk,
      );
      check.expectOk("the rally speed never decreases hit to hit", monotonic);
    },
  };
}
