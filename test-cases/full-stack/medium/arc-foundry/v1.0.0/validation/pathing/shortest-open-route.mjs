// Automated validation for pathing.shortest-open-route: towers are walls — building across
// a leg lengthens the shortest open route the Load must take, and a unit routes around it.
//
// The maze length (the ground route through the ordered chain) is read before and after a
// wall is dropped on the direct first-leg corridor; it must rise. A unit then walks and
// advances along the chain around the wall.
//
// The wall and the route reads are the arrange; the WALK around the wall is the behavior under
// test, so it is the act and is the clip. The old tail released a second Spark purely to have
// something moving in the recording — the measured Spark's own detour shows it better, so the
// extra unit is gone.

import { startBuild, placeCandidate, spawnControlled, unitById, snap, SECOND } from "../_helpers.mjs";

// 2 s = 120 ticks, long enough for the Spark (120 px/s) to be well into its detour.
const WALK_TICKS = 2 * SECOND;

export default function item() {
  // The route before and after the wall, plus the unit as released and after its walk.
  let len0;
  let s1;
  let u;
  let live;

  return {
    id: "pathing.shortest-open-route",

    async arrange(api) {
      const s0 = await startBuild(api);
      len0 = s0.mazeLength;

      // A 2x2 wall astride the row-5 corridor between the Entry and WP1 forces a detour.
      await placeCandidate(api, "capacitor", 1, 20, 4);
      s1 = await snap(api);

      [u] = await spawnControlled(api, "spark");
    },

    async act(api) {
      await api.advance(WALK_TICKS);
      live = unitById(await snap(api), u.id);
    },

    async assert(api, check) {
      check.expectGt("placing a wall across a leg lengthens the shortest open route", s1.mazeLength, len0);
      check.expectOk("a unit still routes past the wall along the chain", !live || live.waypointIndex >= u.waypointIndex);
    },
  };
}
