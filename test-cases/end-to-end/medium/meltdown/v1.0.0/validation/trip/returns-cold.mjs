// Automated validation for the Trip sub-item `returns-cold`.
//
// After about five seconds offline a tripped tower comes back online cold
// (specs/heat.md). We first trip a real emitter (firing carries it to 100 from a
// near-redline precondition), then run past the cooldown and read that it is back
// online with heat 0 — the real trip cooldown resolves it.

import {
  newGame,
  arrangeNearRedline,
  actTripAndRecover,
} from "../_helpers.mjs";

export default function item() {
  let id;
  let r;

  return {
    id: "trip.returns-cold",

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      const c = await arrangeNearRedline(api, "stutter", { heat: 92 });
      id = c.id;
    },

    // The whole trip-and-recover cycle, which is exactly what the clip should show:
    // the emitter overheating, going offline, and coming back cold.
    async act(api) {
      r = await actTripAndRecover(api, id);
    },

    async assert(api, check) {
      check.expectOk("the emitter tripped", r.tripped.hit);
      check.expectOk("the tower came back online", r.back.hit);
      check.expectEq("it is online again", r.back.t.tripped, false);
      check.expectClose("it returns cold (heat 0)", r.back.t.heat, 0, 0.5);
    },
  };
}
