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

import { startBuild, placeCandidate, spawnControlled, unitById, snap, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("pathing.live-repath");

  await startBuild(api);
  // Two matching walls placed this build phase; they stand into the wave as a combinable pair.
  // The first crosses the row-5 corridor, so the floor route genuinely bends around it.
  const wallA = await placeCandidate(api, "capacitor", 1, 20, 4);
  const wallB = await placeCandidate(api, "capacitor", 1, 6, 7);
  const lenBefore = (await snap(api)).mazeLength;

  // Put a unit on the floor (this begins the wave phase) and advance it partway along its leg.
  const [u] = await spawnControlled(api, "mote");
  await api.step(1.5);
  const a = unitById(await snap(api), u.id);

  // Combine the two standing walls DURING the live wave — the recompute re-routes every walking
  // unit from where it stands. A combine is wall-neutral, so the route holds and no tile opens.
  await api.call("setCombineSet", [wallA.id, wallB.id]);
  await api.call("combine", wallA.id);
  const s1 = await snap(api);
  const b = unitById(s1, u.id);

  check.expectOk("the unit is still on the board (re-routed, not removed)", !!b);
  check.expectLt("the unit did not teleport when the maze recomputed", Math.hypot(b.x - a.x, b.y - a.y), 5);
  check.expectClose("the recompute held the route (a combine is wall-neutral)", s1.mazeLength, lenBefore, 0.001);

  await api.step(3.0);
  const c = unitById(await snap(api), u.id);
  check.expectGe("the unit keeps advancing along the chain after re-routing", c ? c.waypointIndex : 99, b.waypointIndex);

  await spawnControlled(api, "spark");
  await liveClip(api);
  return check.verdict();
}
