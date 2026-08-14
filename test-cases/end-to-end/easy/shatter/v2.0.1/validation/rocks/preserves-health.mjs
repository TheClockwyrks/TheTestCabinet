// Automated validation (Warhead) for the Rocks item (Warhead recycle) `preserves-health`: a damaged
// rock recycled by the star re-enters with the SAME remaining health — the star relocates
// it, it does not repair it. A Large already chipped to 1 HP is aimed into the core; after
// the star recycles it, it must still be a Large at 1 HP (not restored to 3).
//
// Posing the chipped Large on its way into the core is instant (`arrange`); the fall into the
// star and the recycle out to an edge are the behavior (`act`), so the clip is the whole
// slingshot. `actUntilRecycled` ticks one at a time because the recycle is detected by
// COMPARING consecutive samples — a coarse poll would step over the jump.
//
// The 2 s the old drive allowed is 2 x 120 = 240 ticks.

import { newGame, actUntilRecycled } from "../_helpers.mjs";

export default function item() {
  // Whether the rock was recycled, and the state it re-entered in.
  let outcome;

  return {
    id: "rocks.preserves-health",

    async arrange(api) {
      await newGame(api);
      await api.call("addRock", "large", {
        x: 640,
        y: 200,
        vx: 0,
        vy: 240,
        health: 1,
      });
    },

    async act(api) {
      outcome = await actUntilRecycled(api, { maxTicks: 240 });
    },

    async assert(api, check) {
      const snap = outcome.snap;
      check.expectOk(
        "the damaged rock is recycled by the star",
        outcome.recycled,
      );
      check.expectEq(
        "the recycled rock is still a Large (relocated, not replaced)",
        snap.rocks[0] ? snap.rocks[0].size : "gone",
        "large",
      );
      check.expectEq(
        "the recycle preserves its 1 HP — the star does not repair it",
        snap.rocks[0] ? snap.rocks[0].health : -1,
        1,
      );
    },
  };
}
