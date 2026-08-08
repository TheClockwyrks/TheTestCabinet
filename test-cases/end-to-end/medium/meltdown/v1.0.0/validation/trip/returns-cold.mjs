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

// The Stutter stands at the gate so it engages the Core whatever route that build walks
// it on. The trip has to happen for real before there is a cooldown to read, and an
// emitter aimed at a lane the build does not use never fires — which would fail this
// item on its first assertion for a pathing choice `pathing.opposite-left` already
// owns. See `buildGate` in `_helpers`.

import {
  newGame,
  arrangeNearRedline,
  actTripAndRecover,
  actTail,
  REDLINE,
  GATE_WALLS,
} from "../_helpers.mjs";

export default function item() {
  let id;
  let walls;
  let r;

  return {
    id: "trip.returns-cold",

    // The trip cooldown is a fixed 5 s (specs/heat.md) and the emitter has to reach the
    // redline first, so this is the longest of the trip items by nature — and it has to
    // cover the beat AFTER the return as well, or the clip ends on the frame its subject
    // arrives (see the tail in `act`).
    clipMs: 14000,

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      const c = await arrangeNearRedline(api, "stutter", {
        heat: 92,
        gate: true,
      });
      id = c.id;
      walls = c.walls;
    },

    // The whole trip-and-recover cycle, which is exactly what the clip should show:
    // the emitter overheating, going offline, and coming back cold.
    //
    // The tail is what puts the RETURN in the clip. It used to be argued away — the
    // drive already spends five seconds on a visibly tripped tower, so the return lands
    // in a clip that has been holding on its subject throughout — and that reasoning
    // covers the wait but not the arrival. `actTripAndRecover` stops on the first step
    // the tower is back online, and `act` returning ends the record pass, so the clip
    // ran out exactly as the thing it is named for happened: a reviewer watched six
    // seconds of a red, dead tower and never saw it light up. Three seconds afterwards
    // is the tower back on the floor, cold, and visibly heating from scratch — which is
    // the whole of "returns cold".
    async act(api) {
      r = await actTripAndRecover(api, id);
      await actTail(api, 180); // 3 s of the recovered tower online and warming again
    },

    async assert(api, check) {
      // A hole in the gate lets the Core walk round the emitter, which would read here
      // as a tower that never tripped rather than as missing scenery.
      check.expectEq("the gate wall was built", walls, GATE_WALLS);
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
