// Automated validation for the Pathing sub-item `opposite-left`.
//
// A unit entering the left vent is assigned the right (opposite) exhaust and leaves
// there, never the nearer one (specs/reactor.md). We spawn a real Mote at the left
// vent, read its assigned exhaust, and drive it across the floor to the right edge.

import { newGame, spawn, unit } from "../_helpers.mjs";

export default function item() {
  let moteId;
  let start;
  let r;

  return {
    id: "pathing.opposite-left",

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      moteId = await spawn(api, "mote", "left");
      start = await unit(api, moteId);
    },

    // Drive it across to the right side of the floor (the opposite exhaust). 1800
    // ticks = the old 30s cap, polled every 6 ticks (the old 0.1s chunk) — the
    // crossing is gradual, so a coarse sweep is enough.
    async act(api) {
      r = await api.until(
        (s) => s.surge.some((u) => u.id === moteId && u.x > 900),
        {
          max: 1800,
          poll: 6,
        },
      );
    },

    async assert(api, check) {
      check.expectEq(
        "a left-vent unit is assigned the right exhaust",
        start.exhaust,
        "right",
      );
      check.expectEq("it enters from the left vent", start.vent, "left");
      check.expectOk("it crosses to the right side of the floor", r.hit);
    },
  };
}
