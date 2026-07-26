// Automated validation for the Forge sub-item `caps-setpoint`.
//
// The Forge warms an emitter only toward its setpoint, never past it (specs/heat.md),
// so it can never push a gun to the trip on its own. A level-I Forge's setpoint is
// 72%. An Arc posed below the setpoint is warmed by a real Forge and run forward
// for a long time; its heat rises but settles below the setpoint and never exceeds
// it.

import { newGame, build, heatOf } from "../_helpers.mjs";

export default function item() {
  let arcId;
  let start;
  let maxSeen;
  let settled;

  return {
    id: "forge.caps-setpoint",

    // An Arc posed well below the level-I setpoint, with a Forge feeding it.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      arcId = await build(api, "arc", 12, 12);
      await build(api, "forge", 12, 14);
      await api.call("setHeat", arcId, 50); // below the level-I setpoint of 72
    },

    // Sample the heat repeatedly rather than only at the end: the claim is that the
    // Forge never OVERSHOOTS the setpoint, which a single final reading could miss if
    // the heat rose past 72 and settled back. 15 ticks = the old 0.25s sample
    // interval, 40 samples = the old 10s of warming.
    async act(api) {
      start = await heatOf(api, arcId);
      maxSeen = start;
      for (let i = 0; i < 40; i += 1) {
        await api.advance(15);
        maxSeen = Math.max(maxSeen, await heatOf(api, arcId));
      }
      settled = await heatOf(api, arcId);
    },

    async assert(api, check) {
      check.expectGt(
        "the Forge warms the gun above where it started",
        settled,
        start,
      );
      check.expectLt(
        "the Forge never pushes the gun past its 72% setpoint",
        maxSeen,
        72,
      );
    },
  };
}
