// Automated validation for pathing.no-build-on-waypoint: a placement whose footprint would
// cover a waypoint-platform tile is refused, so a waypoint can never be walled off.
//
// The first waypoint's anchor is read from the snapshot; a 2x2 anchored one tile left of it
// covers platform tiles and is refused (nothing lands, no stamp spent).

import { startBuild, snap } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("pathing.no-build-on-waypoint");

  const s0 = await startBuild(api);
  const wp = s0.waypoints[0];
  const before = s0.towers.length;
  const stamps0 = s0.stampsLeft;

  await api.call("setNextRoll", "capacitor", 1);
  await api.call("placeRock", wp.col - 1, wp.row); // footprint covers the waypoint platform
  const s1 = await snap(api);
  check.expectEq("a placement on a waypoint platform lands no candidate", s1.towers.length, before);
  check.expectEq("...and consumes no stamp", s1.stampsLeft, stamps0);

  await api.screenshot("refused");
  return check.verdict();
}
