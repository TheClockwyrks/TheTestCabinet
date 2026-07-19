// Automated validation for pathing.dismantle-repath: dismantling a structure frees its
// footprint and re-paths the floor, shortening the ground route back.
//
// A wall is placed across a leg (the route lengthens), then dismantled; the maze length must
// return to its original value.

import { startBuild, placeCandidate, spawnControlled, snap, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("pathing.dismantle-repath");

  const s0 = await startBuild(api);
  const len0 = s0.mazeLength;

  const cand = await placeCandidate(api, "capacitor", 1, 20, 4);
  const len1 = (await snap(api)).mazeLength;
  check.expectGt("the wall lengthened the route", len1, len0);

  await api.call("dismantle", cand.id);
  const len2 = (await snap(api)).mazeLength;
  check.expectLt("dismantling the wall shortened the route back", len2, len1);
  check.expectClose("the route returned to its original length", len2, len0, 0.001);

  await spawnControlled(api, "spark");
  await liveClip(api);
  return check.verdict();
}
