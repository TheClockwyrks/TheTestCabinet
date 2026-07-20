// Automated validation for pathing.flyer-ignores-maze: the Filament flies a straight line
// over the walls from the Entry through the waypoints to the Collector.
//
// On the default map the Entry (0,5) and WP1 (44,5) share row 5, so the flyer's straight
// line runs along y=166. Walls dropped on that corridor would divert a ground unit; the
// flyer's y must stay constant as its x advances — it ignores the maze.
//
// Walling the corridor and releasing the Filament are control ops (the arrange). The FLIGHT
// across those walls is both the behavior under test and the thing worth watching, so it is the
// act — the three seconds the measurement spans IS the clip. (The old script appended a second
// Filament and a real-time tail after the measurement; that showed nothing the measured flight
// does not already show, so it is gone.)

import { startBuild, placeCandidate, spawnControlled, unitById, snap, SECOND } from "../_helpers.mjs";

// 3 s of flight = 180 ticks, enough to clear the walled corridor by a wide margin.
const FLIGHT_TICKS = 3 * SECOND;

export default function item() {
  // The flyer as released and as it stood after crossing the walls.
  let f;
  let live;

  return {
    id: "pathing.flyer-ignores-maze",

    async arrange(api) {
      await startBuild(api);
      // Wall the ground corridor heavily (still non-sealing).
      await placeCandidate(api, "capacitor", 1, 20, 4);
      await placeCandidate(api, "capacitor", 1, 20, 7);

      [f] = await spawnControlled(api, "filament");
    },

    async act(api) {
      await api.advance(FLIGHT_TICKS);
      live = unitById(await snap(api), f.id);
    },

    async assert(api, check) {
      check.expectOk("the Filament is airborne", f.flying === true);
      check.expectOk("the flyer is still mid-flight", !!live && live.flying);
      check.expectClose("the flyer flies straight over the walls (its y is unchanged)", live.y, f.y, 6);
      check.expectGt("...while advancing toward the waypoint over the walls", live.x, f.x + 100);
    },
  };
}
