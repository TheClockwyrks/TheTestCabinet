// Automated validation for the Targeting sub-item `first-default`.
//
// specs/towers.md: "Every tower defaults to `first`", and `first` is "the valid unit furthest
// along the conduit (closest to the collector)". So this item is the one member of the
// targeting family that arms NOTHING — the default is the thing under test, and a tower that
// has had `setTargeting` called on it can no longer demonstrate it.
//
// It shares the three-atom scene with the five explicit priorities (`poseTargetingScene` in
// `_helpers.mjs`), which is what makes the family comparable: the same board, the same three
// atoms, a different one singled out each time. Here it is C, posed 110 arc length ahead of
// the Beam's covering point.

import {
  startScenario,
  poseTargetingScene,
  actTargetingPick,
  checkTargetingPick,
  unitById,
} from "../_helpers.mjs";

export default function item() {
  let scene;
  let result;
  let premise;

  return {
    id: "targeting.first-default",

    // No `setTargeting` call: the tower is left exactly as `placeTower` built it.
    async arrange(api) {
      scene = await poseTargetingScene(api, startScenario, null);
    },

    async act(api) {
      result = await actTargetingPick(api, scene);

      const snap = result.snap;
      premise = [scene.A, scene.B, scene.C].map(
        (id) => unitById(snap, id)?.progress ?? null,
      );
    },

    async assert(api, check) {
      const [a, b, c] = premise;
      check.expectOk(
        "the front atom really was the furthest along when the shot was taken",
        a != null && b != null && c != null && c > b && c > a,
      );
      checkTargetingPick(check, {
        label: "the default priority",
        result,
        pick: scene.C,
      });
    },
  };
}
