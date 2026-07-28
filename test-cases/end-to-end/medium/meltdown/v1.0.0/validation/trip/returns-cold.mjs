// Automated validation for the Trip sub-item `returns-cold`.
//
// After about five seconds offline a tripped tower comes back online cold
// (specs/heat.md). We first trip a real emitter (firing carries it to 100 from a
// near-redline precondition), then run past the cooldown and read that its heat bled
// away to nothing and that it is online again — the real trip cooldown resolves it.
//
// The cold reading is taken on the LAST step the tower is still offline, not on the
// first step it is back. That is not a technicality, it is the only place the claim
// can be read cleanly: a tripped tower "stops firing and deals no damage", so heat
// there is the cooldown's own bleed-off and nothing else, whereas the step it returns
// on may also be the step it re-acquires the Core still walking through its range and
// takes a shot's self-heat. Both are the same conformant behaviour — heat 0, then
// heating from scratch — and which of them a sample lands on depends only on whether
// the build resolves the cooldown before or after firing inside one 60 Hz step, which
// specs/heat.md does not fix. Asserting 0 at the return therefore failed a build for
// its update order: one reference build reads 0 there and another reads a single
// shot's 8.3, from this identical scenario. See `actTripAndRecover`.
//
// The return itself is still checked, twice over: the tower must come back ONLINE,
// and it must come back somewhere near the bottom of the scale rather than where it
// left off. That coarse bound is all the return-instant reading can honestly carry,
// and it is enough — a build that resumes at its pre-trip heat reads ~100 there.

import {
  newGame,
  arrangeNearRedline,
  actTripAndRecover,
  REDLINE,
} from "../_helpers.mjs";

export default function item() {
  let id;
  let r;

  return {
    id: "trip.returns-cold",

    // The trip cooldown is a fixed 5 s (specs/heat.md) and the emitter has to reach the
    // redline first, so this is the longest of the trip items by nature.
    clipMs: 10000,

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      const c = await arrangeNearRedline(api, "stutter", { heat: 92 });
      id = c.id;
    },

    // The whole trip-and-recover cycle, which is exactly what the clip should show:
    // the emitter overheating, going offline, and coming back cold.
    //
    // No tail. This is the one event item that does not need one: the drive already
    // spends five seconds on a visibly tripped tower before it comes back, so the
    // return lands in a clip that has been holding on the subject the whole time
    // rather than cutting the instant something happens.
    async act(api) {
      r = await actTripAndRecover(api, id);
    },

    async assert(api, check) {
      check.expectOk("the emitter tripped", r.tripped.hit);
      check.expectOk(
        "it was seen offline in its cooldown",
        r.lastTripped !== null,
      );
      // The claim, read where firing cannot reach it: by the end of the cooldown the
      // tripped tower's heat has bled away to nothing.
      check.expectClose(
        "its heat bleeds to 0 across the trip cooldown",
        r.lastTripped ? r.lastTripped.heat : NaN,
        0,
        0.5,
      );
      check.expectOk("the tower came back online", r.back.hit);
      check.expectEq("it is online again", r.back.t.tripped, false);
      // Coarse, and deliberately so: it only has to rule out a build that comes back
      // where it tripped. A quarter of the trip threshold is far above one shot of
      // self-heating and far below any resumed heat.
      check.expectLt(
        "it comes back cold, not at the heat it tripped on",
        r.back.t.heat,
        REDLINE / 4,
      );
    },
  };
}
