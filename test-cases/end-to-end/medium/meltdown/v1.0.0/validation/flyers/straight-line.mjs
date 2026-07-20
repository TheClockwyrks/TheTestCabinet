// Automated validation for the Flyers sub-item `straight-line`.
//
// A Drift flyer flies a straight line from its vent to the opposite exhaust, over
// every tower and wall (specs/surge.md, reactor.md). We wall the ground lane, spawn a
// real Drift, and confirm it keeps its cross-axis (y) coordinate as it crosses to the
// right — ignoring the maze entirely.

import { newGame, build, spawn, unit, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("flyers.straight-line");

  await newGame(api, "containment", "medium", 100000);
  await api.call("setLives", 100000);
  // A wall across the ground lane — a flyer ignores it. Built from Sinks (movers
  // that never fire) so the wall proves the flyer flies over the maze without any
  // emitter shooting it out of the air along the way.
  for (const row of [14, 16, 18, 20]) await build(api, "sink", 25, row);

  const id = await spawn(api, "drift", "left");
  const start = await unit(api, id);
  check.expectEq("the unit is a flyer", start.flying, true);

  const r = await stepUntil(api, (s) => s.surge.some((u) => u.id === id && u.x > 900), 20, 0.1);
  const end = await unit(api, id);
  check.expectOk("the flyer crosses to the right, over the wall", r.hit);
  check.expectClose("the flyer holds a straight line (constant y)", end.y, start.y, 3);

  await spawn(api, "drift", "left");
  await liveClip(api, 2000);
  return check.verdict();
}
