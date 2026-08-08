// Automated validation for the Targeting sub-item `nearest`.
//
// specs/towers.md: `nearest` is "the valid unit at the shortest straight-line distance from
// the tower's own placed position (independent of path progress)" — the priority that reads
// the board rather than the conduit.
//
// WHICH ATOM THAT IS, IS MEASURED. The scene poses B at the Beam's own covering point and A
// and C 150 behind and 110 ahead of it, so on a straight run B is obviously the nearest —
// but a map's geometry is the model's own, and specs/board.md lets a single path serpentine.
// A path that folds back can put the atom 150 arc length upstream physically closer to the
// tower than the one beside it, and an item that assumed the layout would then grade a
// correct build against the wrong atom. So `poseTargetingScene` hands back the three real
// distances and this item takes the nearest of them, asserting the margin it got.

import {
  startScenario,
  poseTargetingScene,
  actTargetingPick,
  checkTargetingPick,
  towerById,
  unitById,
  preconditionUnmet,
  DISTANCE_MARGIN_PX,
} from "../_helpers.mjs";

export default function item() {
  let scene;
  let nearestId;
  let result;
  let margin;
  let posedGap;

  return {
    id: "targeting.nearest",

    async arrange(api) {
      scene = await poseTargetingScene(api, startScenario, "nearest");
      const [closest, second] = scene.byDistance;
      nearestId = closest;
      posedGap = scene.dist[second] - scene.dist[closest];
      // A scene whose three atoms are effectively equidistant poses no answerable question,
      // which is a fact about this map's geometry rather than about the build. Report it as
      // an unmet precondition instead of grading a coin toss.
      if (scene.dist[second] - scene.dist[closest] < DISTANCE_MARGIN_PX) {
        throw preconditionUnmet(
          `the scene's two closest atoms are ${Math.round(
            scene.dist[second] - scene.dist[closest],
          )}px apart from the tower, too little to pose a NEAREST choice`,
        );
      }
    },

    async act(api) {
      result = await actTargetingPick(api, scene);

      // Re-measure at the instant the graded shot was launched: the atoms have been moving,
      // and the verdict should rest on the standing that actually held then.
      const tower = towerById(result.snap, scene.towerId);
      const distances = [scene.A, scene.B, scene.C].map((id) => {
        const u = unitById(result.snap, id);
        return {
          id,
          d: u ? Math.hypot(u.x - tower.x, u.y - tower.y) : Infinity,
        };
      });
      distances.sort((p, q) => p.d - q.d);
      margin = { winner: distances[0].id };
    },

    async assert(api, check) {
      check.expectEq(
        "the atom nearest the tower when the shot was taken is the one posed as nearest",
        margin.winner,
        nearestId,
      );
      // The MARGIN is asserted on the pose, not on the instant the shot landed. The atoms
      // travel while the tower reloads (1.2 s for a Beam), so a gap that was decisive when
      // the tower chose can have closed by the time its shot arrives — on one build the
      // posed spread of 91px had narrowed to 12px, and the item failed a correct choice for
      // it. The pose is when the priority is exercised, so the pose is what has to pose a
      // clear question; `arrange` refuses the scene outright if it does not.
      check.expectGt(
        "the scene posed a clear nearest, not a tie (px)",
        posedGap,
        DISTANCE_MARGIN_PX,
      );
      checkTargetingPick(check, {
        label: "NEAREST",
        result,
        pick: nearestId,
      });
    },
  };
}
