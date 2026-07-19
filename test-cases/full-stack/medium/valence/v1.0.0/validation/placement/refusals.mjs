// Automated validation for the Placement sub-item `refusals`.
//
// An illegal placement is refused with the correct reason. The check drives the real
// placement path at points chosen to trip each rule: exactly ON a path (reason
// `path`), out of bounds (`bounds`), over an existing tower (`overlap`), and — with the
// bank emptied — unaffordable (`cost`). Each refusal must name its own reason.

import { startRun, pathGeom, MAP, HUGE_ENERGY } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("placement.refusals");

  const snap = await startRun(api, MAP.single, { energy: HUGE_ENERGY });
  const g = pathGeom(snap.paths[0]);
  const onPath = g.pointAt(g.length * 0.2);
  const nx = -Math.sin(onPath.ang);
  const ny = Math.cos(onPath.ang);
  const legal = { x: onPath.x + nx * 48, y: onPath.y + ny * 48 };

  // On a path -> refused with reason "path".
  const rPath = await api.call("placeTower", "emitter", onPath.x, onPath.y);
  check.expectOk("placing on a path is refused", rPath.ok === false);
  check.expectEq("...with reason 'path'", rPath.reason, "path");

  // Out of bounds -> refused with reason "bounds".
  const rBounds = await api.call("placeTower", "emitter", 3, 3);
  check.expectOk("placing out of bounds is refused", rBounds.ok === false);
  check.expectEq("...with reason 'bounds'", rBounds.reason, "bounds");

  // A first legal tower succeeds; a second at the same spot overlaps it.
  const rFirst = await api.call("placeTower", "emitter", legal.x, legal.y);
  check.expectOk("a legal off-path spot is accepted", rFirst.ok === true);
  const rOverlap = await api.call("placeTower", "emitter", legal.x, legal.y);
  check.expectOk("placing over a tower is refused", rOverlap.ok === false);
  check.expectEq("...with reason 'overlap'", rOverlap.reason, "overlap");

  // Unaffordable -> refused with reason "cost".
  await api.call("setEnergy", 0);
  const rCost = await api.call("placeTower", "emitter", onPath.x - nx * 64, onPath.y - ny * 64);
  check.expectOk("an unaffordable placement is refused", rCost.ok === false);
  check.expectEq("...with reason 'cost'", rCost.reason, "cost");

  await api.wait(150);
  await api.screenshot("board");
  return check.verdict();
}
