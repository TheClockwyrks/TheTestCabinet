// Automated validation for the Placement sub-item `refusals`.
//
// An illegal placement is refused with the correct reason. The check drives the real
// placement path at points chosen to trip each rule: exactly ON a path (reason
// `path`), out of bounds (`bounds`), over an existing tower (`overlap`), and — with the
// bank emptied — unaffordable (`cost`). Each refusal must name its own reason.

import { startRun, pathGeom, MAP, HUGE_ENERGY } from "../_helpers.mjs";

export default function item() {
  let onPath;
  let nx;
  let ny;
  let legal;
  let rPath;
  let rBounds;
  let rFirst;
  let rOverlap;
  let rCost;

  return {
    id: "placement.refusals",

    // Only the board and the four points are set up here; every attempt is the behavior.
    async arrange(api) {
      const snap = await startRun(api, MAP.single, { energy: HUGE_ENERGY });
      const g = pathGeom(snap.paths[0]);
      onPath = g.pointAt(g.length * 0.2);
      nx = -Math.sin(onPath.ang);
      ny = Math.cos(onPath.ang);
      legal = { x: onPath.x + nx * 48, y: onPath.y + ny * 48 };
    },

    // The four attempts, in the order that makes each rule the one that trips. They are
    // control ops, so no simulation time passes — the clip is the board being tried and
    // refused, ending on the state the last refusal left.
    async act(api) {
      // On a path -> refused with reason "path".
      rPath = await api.call("placeTower", "emitter", onPath.x, onPath.y);

      // Out of bounds -> refused with reason "bounds".
      rBounds = await api.call("placeTower", "emitter", 3, 3);

      // A first legal tower succeeds; a second at the same spot overlaps it.
      rFirst = await api.call("placeTower", "emitter", legal.x, legal.y);
      rOverlap = await api.call("placeTower", "emitter", legal.x, legal.y);

      // Unaffordable -> refused with reason "cost".
      await api.call("setEnergy", 0);
      rCost = await api.call(
        "placeTower",
        "emitter",
        onPath.x - nx * 64,
        onPath.y - ny * 64,
      );

      await api.settle(150);
      await api.screenshot("board");
    },

    async assert(api, check) {
      check.expectOk("placing on a path is refused", rPath.ok === false);
      check.expectEq("...with reason 'path'", rPath.reason, "path");

      check.expectOk("placing out of bounds is refused", rBounds.ok === false);
      check.expectEq("...with reason 'bounds'", rBounds.reason, "bounds");

      check.expectOk("a legal off-path spot is accepted", rFirst.ok === true);
      check.expectOk("placing over a tower is refused", rOverlap.ok === false);
      check.expectEq("...with reason 'overlap'", rOverlap.reason, "overlap");

      check.expectOk(
        "an unaffordable placement is refused",
        rCost.ok === false,
      );
      check.expectEq("...with reason 'cost'", rCost.reason, "cost");
    },
  };
}
