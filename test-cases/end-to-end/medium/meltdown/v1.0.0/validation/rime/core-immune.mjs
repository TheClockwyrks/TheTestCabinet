// Automated validation for the Rime sub-item `core-immune`.
//
// A Core boss cannot be slowed (specs/surge.md) — a Rime's slow has no effect on it.
// A cold Rime is placed by the lane with a real Core walking through its range; after
// the Rime has fired, the Core reports its full base speed and is not slowed.

import { newGame, build, spawn, unit } from "../_helpers.mjs";

export default function item() {
  let coreId;
  let c;

  return {
    id: "rime.core-immune",

    // The same cold-Rime-by-the-lane setup as `cold-slows-most`, but with a Core
    // walking through instead of a Mote — so the only difference is the unit's
    // immunity.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      const rime = await build(api, "rime", 3, 18);
      await api.call("setHeat", rime, 0);
      coreId = await spawn(api, "core", "left");
    },

    // 90 ticks = the old 1.5s — long enough that the Rime has certainly fired on the
    // Core in range, so an absent slow means immunity rather than a missed shot.
    async act(api) {
      await api.advance(90);
      c = await unit(api, coreId);
    },

    async assert(api, check) {
      check.expectOk("the Core is on the floor", c !== null);
      check.expectEq("the Core is not slowed by the Rime", c.slowed, false);
      check.expectClose(
        "the Core keeps its full base speed (30 px/s)",
        c.speed,
        c.baseSpeed,
        0.01,
      );
    },
  };
}
