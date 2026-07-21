// Automated validation for pathing.live-repath: when the maze recomputes during a live wave,
// every walking unit is re-routed from where it stands — its position stays continuous (no
// teleport, no snap backward) and it keeps advancing along the chain.
//
// Rocks are placed and structures dismantled only in the build phase, when no units are on the
// floor (specs/board.md). The one wall-touching operation legal DURING a live wave is a combine
// (specs/build.md, specs/controls.md): it is wall-neutral (the initiator stays a wall and the
// consumed partner hardens into a blocker), so it opens no tile — yet committing it recomputes
// the floor and re-routes every unit currently walking from its current tile. Two matching walls
// are placed in the build phase and stand into the wave; a unit is stepped partway along its first
// leg; the walls are then combined live. The unit's position must be continuous across the
// recompute, the route length must hold (wall-neutral), and the unit must keep advancing.
//
// The two walls are the arrange. Everything from the release onward is the act — the unit has to
// be MID-WALK when the recompute lands, which is the whole point, and both the walk and the
// live combine are control-op-and-time work that `act` allows. That also makes the clip exactly
// right: a unit walking, the maze recomputing under it, and the unit carrying on.

import { startBuild, placeCandidate, spawnControlled, unitById, snap, SECOND } from "../_helpers.mjs";

// 1.5 s = 90 ticks: far enough along the first leg that a teleport would be unmistakable.
const WALK_TICKS = 1.5 * SECOND;
// 3 s = 180 ticks after the recompute, to show the unit keeps making progress.
const AFTER_TICKS = 3 * SECOND;

export default function item() {
  // The pair of walls, the route before, and the unit at each of the three readings.
  let wallAId;
  let wallBId;
  let lenBefore;
  let a;
  let b;
  let c;
  let s1;

  return {
    id: "pathing.live-repath",

    async arrange(api) {
      await startBuild(api);
      // Two matching walls placed this build phase; they stand into the wave as a combinable pair.
      // The first crosses the row-5 corridor, so the floor route genuinely bends around it.
      const wallA = await placeCandidate(api, "capacitor", 1, 20, 4);
      const wallB = await placeCandidate(api, "capacitor", 1, 6, 7);
      wallAId = wallA.id;
      wallBId = wallB.id;
      lenBefore = (await snap(api)).mazeLength;
    },

    async act(api) {
      // Put a unit on the floor (this begins the wave phase) and advance it partway along its leg.
      const [u] = await spawnControlled(api, "mote");
      await api.advance(WALK_TICKS);
      a = unitById(await snap(api), u.id);

      // Combine the two standing walls DURING the live wave — the recompute re-routes every walking
      // unit from where it stands. A combine is wall-neutral, so the route holds and no tile opens.
      await api.call("setCombineSet", [wallAId, wallBId]);
      await api.call("combine", wallAId);
      s1 = await snap(api);
      b = unitById(s1, u.id);

      await api.advance(AFTER_TICKS);
      c = unitById(await snap(api), u.id);
    },

    async assert(api, check) {
      check.expectOk("the unit is still on the board (re-routed, not removed)", !!b);
      check.expectLt("the unit did not teleport when the maze recomputed", Math.hypot(b.x - a.x, b.y - a.y), 5);
      check.expectClose("the recompute held the route (a combine is wall-neutral)", s1.mazeLength, lenBefore, 0.001);
      check.expectGe("the unit keeps advancing along the chain after re-routing", c ? c.waypointIndex : 99, b.waypointIndex);
    },
  };
}
