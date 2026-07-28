// Automated validation for the Trip sub-item `trips-at-100`.
//
// Driving an emitter's heat to 100 trips it offline (specs/heat.md). A Stutter is
// placed with a real Core target in range and posed near its redline as a
// precondition; the real firing/heat systems drive it the rest of the way to 100,
// where the real trip system takes it offline. A tripped tower stops firing, so we
// read `tripped` true and `firing` false — it deals no damage while offline.

import {
  newGame,
  arrangeNearRedline,
  actUntilTripped,
  tower,
} from "../_helpers.mjs";

export default function item() {
  let id;
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
      const c = await arrangeNearRedline(api, "stutter", { heat: 92 });
      id = c.id;
    },

    async act(api) {
      const r = await actUntilTripped(api, id);
      hit = r.hit;
      // The step that crosses the redline still fired earlier in that same step,
      // before the trip took hold; advance one more tick so we observe the tower
      // while it is actually offline — where it deals no damage.
      await api.advance(1);
      t = await tower(api, id);
    },

    async assert(api, check) {
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
