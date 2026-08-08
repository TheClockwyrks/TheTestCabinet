// Automated validation for the Trip sub-item `trips-at-100`.
//
// Driving an emitter's heat to 100 trips it offline (specs/heat.md). A Stutter is
// placed with a real Core target in range and posed near its redline as a
// precondition; the real firing/heat systems drive it the rest of the way to 100,
// where the real trip system takes it offline. A tripped tower stops firing, so we
// read `tripped` true and `firing` false — it deals no damage while offline.
//
// The Stutter stands at the gate rather than parked beside the lane the Core would walk
// if it crossed on its entry rows. What this item needs from the Core is only that the
// Stutter has something real to shoot at; which route the Core takes to the exhaust is
// `pathing.opposite-left`'s subject, and a build that sets off diagonally must not be
// able to fail THIS item — an emitter that never acquires a target never heats, and the
// item would report "did not trip" for a tower that was working perfectly. The gate
// walls the floor from top to bottom with a two-row gap in front of the gun, so every
// route to the exhaust runs through it. See the note above `buildGate` in `_helpers`.

import {
  newGame,
  arrangeNearRedline,
  actUntilTripped,
  tower,
  actTail,
  GATE_WALLS,
} from "../_helpers.mjs";

export default function item() {
  let id;
  let walls;
  let hit;
  let t;

  return {
    id: "trip.trips-at-100",

    // A near-redline emitter needs only a few shots to cross 100, so on a conformant
    // build this is a couple of seconds. The ceiling covers a build whose Core takes
    // longer to walk into range. See CLIP_HEADROOM_MS in _helpers.
    clipMs: 6000,

    // 92 is near the redline; the real firing carries it the rest of the way. The old
    // script's clip tail posed 85 instead, but the clip's job is to show the drive the
    // assertions made, so this films the 92 drive that decides the verdict.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      const c = await arrangeNearRedline(api, "stutter", {
        heat: 92,
        gate: true,
      });
      id = c.id;
      walls = c.walls;
    },

    async act(api) {
      const r = await actUntilTripped(api, id);
      hit = r.hit;
      // The step that crosses the redline still fired earlier in that same step,
      // before the trip took hold; advance one more tick so we observe the tower
      // while it is actually offline — where it deals no damage.
      await api.advance(1);
      t = await tower(api, id);
      // The gate hands the Stutter its target at once, so the trip lands a beat
      // into the drive and the sweep stops on the frame it happens — leaving a clip
      // that ends just as its subject begins. Hold on the tower while it is offline.
      await actTail(api);
    },

    async assert(api, check) {
      // The scenery, first: a hole in the gate lets the Core walk round the Stutter,
      // and "did not trip" would then be about the scenery, not the tower.
      check.expectEq("the gate wall was built", walls, GATE_WALLS);
      check.expectOk("the Stutter tripped from overheating", hit);
      check.expectEq("a tripped tower is offline", t.tripped, true);
      check.expectEq(
        "a tripped tower is not firing (deals no damage)",
        t.firing,
        false,
      );
      check.expectGt("its trip cooldown is counting", t.tripTimer, 0);
    },
  };
}
