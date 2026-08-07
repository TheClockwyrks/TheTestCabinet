// Automated validation for the Targeting sub-item `farthest`.
//
// specs/towers.md: `farthest` is "the valid unit at the greatest straight-line distance from
// the tower, still within range" — the mirror of `nearest`, and the priority a player uses
// to reach across a lane rather than pick off what is on top of the tower.
//
// "Still within range" is the half of that sentence an item can quietly break. A priority
// only ever chooses among the units that are valid and in reach, so a scene whose most
// distant atom has drifted outside the Beam's radius is not posing a FARTHEST question at
// all — it is posing a two-atom one. `actTargetingPick` reports whether all three were
// inside the radius when the graded shot was launched, and `checkTargetingPick` states it.
//
// As with `nearest`, which atom is furthest is MEASURED rather than assumed from where the
// three were posed: specs/board.md lets a single path serpentine, and a fold can put the
// atom 110 arc length ahead of the tower further from it than the one 150 behind.

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
  let farthestId;
  let result;
  let margin;
  let posedGap;

  return {
    id: "targeting.farthest",

    async arrange(api) {
      scene = await poseTargetingScene(api, startScenario, "farthest");
      const ordered = scene.byDistance;
      farthestId = ordered[ordered.length - 1];
      const runnerUp = ordered[ordered.length - 2];
      posedGap = scene.dist[farthestId] - scene.dist[runnerUp];
      if (scene.dist[farthestId] - scene.dist[runnerUp] < DISTANCE_MARGIN_PX) {
        throw preconditionUnmet(
          `the scene's two most distant atoms are ${Math.round(
            scene.dist[farthestId] - scene.dist[runnerUp],
          )}px apart from the tower, too little to pose a FARTHEST choice`,
        );
      }
    },

    async act(api) {
      result = await actTargetingPick(api, scene);

      const tower = towerById(result.snap, scene.towerId);
      const distances = [scene.A, scene.B, scene.C].map((id) => {
        const u = unitById(result.snap, id);
        return { id, d: u ? Math.hypot(u.x - tower.x, u.y - tower.y) : -1 };
      });
      distances.sort((p, q) => q.d - p.d);
      margin = { winner: distances[0].id };
    },

    async assert(api, check) {
      check.expectEq(
        "the atom furthest from the tower when the shot was taken is the one posed as furthest",
        margin.winner,
        farthestId,
      );
      // The MARGIN is asserted on the pose, not on the instant the shot landed. The atoms
      // travel while the tower reloads (1.2 s for a Beam), so a gap that was decisive when
      // the tower chose can have closed by the time its shot arrives — on one build the
      // posed spread of 91px had narrowed to 12px, and the item failed a correct choice for
      // it. The pose is when the priority is exercised, so the pose is what has to pose a
      // clear question; `arrange` refuses the scene outright if it does not.
      check.expectGt(
        "the scene posed a clear furthest, not a tie (px)",
        posedGap,
        DISTANCE_MARGIN_PX,
      );
      checkTargetingPick(check, {
        label: "FARTHEST",
        result,
        pick: farthestId,
      });
    },
  };
}
