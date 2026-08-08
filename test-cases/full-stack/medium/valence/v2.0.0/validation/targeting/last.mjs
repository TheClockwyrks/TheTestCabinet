// Automated validation for the Targeting sub-item `last`.
//
// specs/towers.md: `last` is "the valid unit least far along the conduit (nearest the
// inlet)" — the mirror of the default. In the shared three-atom scene (see
// `poseTargetingScene` in `_helpers.mjs`) that is A, posed 150 arc length behind the Beam's
// covering point with B and C ahead of it.
//
// A is also the scene's highest-hp unit, so `last` and `strongest` resolve to the same atom
// here. That overlap is stated rather than papered over: this item grades the priority
// against the conduit ordering it names, and `targeting.strongest` grades the same atom
// against hit points. Breaking the overlap would mean giving A the fewest electrons, which
// would make it the FASTEST atom on the board (specs/matter.md ties speed to electron
// count) and hand the scene a rear unit that overtakes the two in front of it mid-clip.

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
    id: "targeting.last",

    async arrange(api) {
      scene = await poseTargetingScene(api, startScenario, "last");
    },

    async act(api) {
      result = await actTargetingPick(api, scene);

      // The conduit ordering read out of the very snapshot the graded shot was launched in,
      // rather than from where the atoms were posed. They have been travelling at three
      // different speeds since (an atom's speed falls with its electron count), so the
      // ordering the verdict rests on is the one that held at the instant it was decided.
      const snap = result.snap;
      premise = [scene.A, scene.B, scene.C].map(
        (id) => unitById(snap, id)?.progress ?? null,
      );
    },

    async assert(api, check) {
      const [a, b, c] = premise;
      check.expectOk(
        "the rear atom really was the least far along when the shot was taken",
        a != null && b != null && c != null && a < b && a < c,
      );
      checkTargetingPick(check, {
        label: "LAST",
        result,
        pick: scene.A,
      });
    },
  };
}
