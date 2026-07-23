// Automated validation for the Pathing sub-item `opposite-top`.
//
// A unit entering the top vent is assigned the bottom (opposite) exhaust and leaves
// there, never the nearer one (specs/playfield.md). We spawn a real Mote at the top
// vent, read its assigned exhaust, and drive it down to the bottom edge.

import { newGame, spawn, unit } from "../_helpers.mjs";

export default function item() {
  let moteId;
  let start;
  let r;

  return {
    id: "pathing.opposite-top",

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      moteId = await spawn(api, "mote", "top");
      start = await unit(api, moteId);
    },

    // 1800 ticks = the old 30s cap, polled every 6 ticks (the old 0.1s chunk).
    async act(api) {
      r = await api.until(
        (s) => s.surge.some((u) => u.id === moteId && u.y > 640),
        {
          max: 1800,
          poll: 6,
        },
      );
    },

    async assert(api, check) {
      check.expectEq(
        "a top-vent unit is assigned the bottom exhaust",
        start.exhaust,
        "bottom",
      );
      check.expectEq("it enters from the top vent", start.vent, "top");
      check.expectOk("it crosses down to the bottom of the floor", r.hit);
    },
  };
}
