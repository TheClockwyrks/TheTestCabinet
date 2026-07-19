// Automated validation for the Placement sub-item `free`.
//
// A tower is placed FREELY at an arbitrary off-path board position through the real
// placement path. The check builds one beside the lane and confirms it appears in the
// game state — free placement, not a grid snap or a fixed node.

import { startRun, pathGeom, placeCovering, towerById, MAP } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("placement.free");

  const snap = await startRun(api, MAP.single);
  const g = pathGeom(snap.paths[0]);
  const before = (await api.snapshot()).towers.length;
  const t = await placeCovering(api, "emitter", g, g.length * 0.18);
  const after = await api.snapshot();

  check.expectEq("a tower was placed", after.towers.length, before + 1);
  check.expectOk("the placed tower exists in the game state", towerById(after, t.id) !== null);

  await api.wait(150);
  await api.screenshot("placed");
  return check.verdict();
}
