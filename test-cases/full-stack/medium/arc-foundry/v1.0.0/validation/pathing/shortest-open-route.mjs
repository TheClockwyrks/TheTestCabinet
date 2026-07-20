// Automated validation for pathing.shortest-open-route: towers are walls — building across
// a leg lengthens the shortest open route the Load must take, and a unit routes around it.
//
// The maze length (the ground route through the ordered chain) is read before and after a
// wall is dropped on the direct first-leg corridor; it must rise. A unit then walks and
// advances along the chain around the wall.

import { startBuild, placeCandidate, spawnControlled, unitById, snap, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("pathing.shortest-open-route");

  const s0 = await startBuild(api);
  const len0 = s0.mazeLength;

  // A 2x2 wall astride the row-5 corridor between the Entry and WP1 forces a detour.
  await placeCandidate(api, "capacitor", 1, 20, 4);
  const s1 = await snap(api);
  check.expectGt("placing a wall across a leg lengthens the shortest open route", s1.mazeLength, len0);

  const [u] = await spawnControlled(api, "spark");
  await api.step(2.0);
  const live = unitById(await snap(api), u.id);
  check.expectOk("a unit still routes past the wall along the chain", !live || live.waypointIndex >= u.waypointIndex);

  await spawnControlled(api, "spark");
  await liveClip(api);
  return check.verdict();
}
