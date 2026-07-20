// Automated validation for the Refund sub-item `reopens`.
//
// Selling a tower reopens every tile in its footprint and re-paths the surge
// (specs/towers.md), so a route it lengthened shortens again. We measure the left
// vent's route, wall the lane (lengthening it), then sell the wall and confirm the
// route returns to its original length.

import { newGame, build, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("refund.reopens");

  await newGame(api, "containment", "medium", 100000);
  const before = (await api.snapshot()).paths.left.length;

  const ids = [];
  for (const row of [14, 16, 18, 20]) ids.push(await build(api, "arc", 25, row));
  const walled = (await api.snapshot()).paths.left.length;
  check.expectGt("the wall lengthened the route", walled, before);

  for (const id of ids) await api.call("sellTower", id);
  const after = (await api.snapshot()).paths.left.length;
  check.expectEq("selling the wall reopens the route to its original length", after, before);

  // A clip: rebuild the wall and sell it, watching the route reopen.
  for (const row of [14, 16, 18, 20]) await build(api, "arc", 25, row);
  await liveClip(api, 1400);
  return check.verdict();
}
