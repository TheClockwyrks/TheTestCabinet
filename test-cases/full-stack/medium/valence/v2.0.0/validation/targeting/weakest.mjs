// Automated validation for the Targeting sub-item `weakest`.
//
// specs/towers.md: `weakest` is "the valid unit with the fewest remaining hit points". In the
// shared three-atom scene that is B, the 1-electron atom posed in the MIDDLE of the group —
// deliberately neither the furthest along the conduit nor the least far along it, so a build
// that has wired `weakest` to `first` or to `last` reaches for C or A instead and is caught.
// (B is the nearest atom to the tower on an ordinary layout, which `targeting.nearest`
// grades on its own measured terms; a build that confuses the two is caught there, where
// distance is what is being asserted.)
//
// B is also the fastest atom on the board — an atom's speed rises as its electron count
// falls (specs/matter.md: 1 electron is 112 px/s against a 6-electron atom's 44) — so it is
// closing on C for the whole clip. That is exactly why the conduit ordering the verdict
// rests on is re-read at the instant the graded shot is launched rather than taken from
// where the three were posed.

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
  let hp;
  let progress;

  return {
    id: "targeting.weakest",

    async arrange(api) {
      scene = await poseTargetingScene(api, startScenario, "weakest");
    },

    async act(api) {
      result = await actTargetingPick(api, scene);

      const read = (id) => unitById(result.snap, id);
      hp = Object.fromEntries(
        [scene.A, scene.B, scene.C].map((id) => [id, read(id)?.hp ?? null]),
      );
      progress = Object.fromEntries(
        [scene.A, scene.B, scene.C].map((id) => [
          id,
          read(id)?.progress ?? null,
        ]),
      );
    },

    async assert(api, check) {
      check.expectOk(
        "the posed weak atom really did hold the fewest hit points when the shot was taken",
        hp[scene.B] != null &&
          hp[scene.A] != null &&
          hp[scene.C] != null &&
          hp[scene.B] < hp[scene.A] &&
          hp[scene.B] < hp[scene.C],
      );
      // The whole point of posing the weak atom in the middle: if it had drifted to the head
      // or the tail of the group, picking it would no longer distinguish `weakest` from
      // `first` or `last`, and a pass would prove nothing.
      check.expectOk(
        "...and was still neither the furthest along nor the least far along, so the choice is unambiguous",
        progress[scene.B] != null &&
          progress[scene.A] != null &&
          progress[scene.C] != null &&
          progress[scene.B] > progress[scene.A] &&
          progress[scene.B] < progress[scene.C],
      );
      checkTargetingPick(check, {
        label: "WEAKEST",
        result,
        pick: scene.B,
      });
    },
  };
}
