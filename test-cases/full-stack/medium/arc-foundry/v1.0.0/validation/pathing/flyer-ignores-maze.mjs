// Automated validation for pathing.flyer-ignores-maze: the Filament flies a straight line
// over the walls from the Entry through the waypoints to the Collector.
//
// On the default map the Entry (0,5) and WP1 (44,5) share row 5, so the flyer's straight
// line runs along y=166. Walls dropped on that corridor would divert a ground unit; the
// flyer's y must stay constant as its x advances — it ignores the maze.

import { startBuild, placeCandidate, spawnControlled, unitById, snap, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("pathing.flyer-ignores-maze");

  await startBuild(api);
  // Wall the ground corridor heavily (still non-sealing).
  await placeCandidate(api, "capacitor", 1, 20, 4);
  await placeCandidate(api, "capacitor", 1, 20, 7);

  const [f] = await spawnControlled(api, "filament");
  check.expectOk("the Filament is airborne", f.flying === true);

  await api.step(3.0);
  const live = unitById(await snap(api), f.id);
  check.expectOk("the flyer is still mid-flight", !!live && live.flying);
  check.expectClose("the flyer flies straight over the walls (its y is unchanged)", live.y, f.y, 6);
  check.expectGt("...while advancing toward the waypoint over the walls", live.x, f.x + 100);

  await spawnControlled(api, "filament");
  await liveClip(api);
  return check.verdict();
}
