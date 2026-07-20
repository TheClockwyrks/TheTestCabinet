// Automated validation for the Mazing sub-item `towers-are-walls`.
//
// Every tower is also a wall: placing towers across the direct route forces the
// surge to path the long way around (specs/reactor.md). We read the left vent's
// shortest route to its exhaust before and after building a wall across the straight
// lane — it lengthens.

import { newGame, build, spawn, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("mazing.towers-are-walls");

  await newGame(api, "containment", "medium", 100000);
  const before = (await api.snapshot()).paths.left.length;

  // A vertical wall across mid-field, blocking the straight left->right lane.
  for (const row of [14, 16, 18, 20]) await build(api, "arc", 25, row);
  const after = (await api.snapshot()).paths.left.length;

  check.expectGt("a wall across the lane lengthens the left vent's route", after, before);

  // A clip: a unit routing the long way around the wall.
  await spawn(api, "mote", "left");
  await spawn(api, "mote", "left");
  await liveClip(api, 2200);
  return check.verdict();
}
