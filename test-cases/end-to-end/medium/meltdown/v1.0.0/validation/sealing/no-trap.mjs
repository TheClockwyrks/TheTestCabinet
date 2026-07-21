// Automated validation for the Sealing sub-item `no-trap`.
//
// A placement that would trap a unit already walking (leaving it no route) is
// refused (specs/reactor.md). We wall column 25 leaving one two-tile gap, spawn a
// real Mote walking toward that last opening, and confirm the placement that would
// close the gap on the walking unit is refused.

import { newGame, build, spawn } from "../_helpers.mjs";

export default function item() {
  let mote;
  let can;

  return {
    id: "sealing.no-trap",

    // The same one-gap wall as `no-seal`, plus a real Mote released toward the gap.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      for (const row of [
        0, 2, 4, 6, 8, 10, 12, 14, 18, 20, 22, 24, 26, 28, 30, 32, 34,
      ]) {
        await build(api, "arc", 25, row);
      }
      mote = await spawn(api, "mote", "left");
    },

    // Let the Mote walk partway toward the gap — the refusal is about a unit that is
    // already committed to the route, so it has to actually be walking it. 720 ticks =
    // the old 12s cap, polled every 6 ticks (the old 0.1s chunk).
    async act(api) {
      await api.until((s) => s.surge.some((u) => u.id === mote && u.x > 200), {
        max: 720,
        poll: 6,
      });
      can = await api.call("canPlace", "arc", 25, 16, 0);
    },

    async assert(api, check) {
      check.expectEq(
        "closing the gap on the walking unit is refused",
        can,
        false,
      );
    },
  };
}
