// Automated validation for the Placement sub-item `free`.
//
// A tower is placed FREELY at an arbitrary off-path board position through the real
// placement path. The check builds one beside the lane and confirms it appears in the
// game state — free placement, not a grid snap or a fixed node.

import {
  startRun,
  pathGeom,
  placeCovering,
  towerById,
  MAP,
} from "../_helpers.mjs";

export default function item() {
  let g;
  let before;
  let t;
  let after;

  return {
    id: "placement.free",

    async arrange(api) {
      const snap = await startRun(api, MAP.single);
      g = pathGeom(snap.paths[0]);
      before = (await api.snapshot()).towers.length;
    },

    // The placement itself is the behavior, so it belongs here rather than in the set-up.
    // `settle` is a real repaint pause in both passes, so the still shows the tower drawn
    // where it was put.
    async act(api) {
      t = await placeCovering(api, "emitter", g, g.length * 0.18);
      after = await api.snapshot();
      await api.settle(150);
      await api.screenshot("placed");
    },

    async assert(api, check) {
      check.expectEq("a tower was placed", after.towers.length, before + 1);
      check.expectOk(
        "the placed tower exists in the game state",
        towerById(after, t.id) !== null,
      );
    },
  };
}
