// Automated validation for the Targeting sub-item `strongest`.
//
// specs/towers.md: `strongest` is "the valid unit with the most remaining hit points". In the
// shared three-atom scene that is A, the 6-electron atom — and an atom's electrons ARE its
// shells (specs/matter.md), drawn on its two rings and shed one at a time as it is stripped,
// so the difference this priority chooses on is a difference a reviewer can see: six dots
// against three and one.
//
// That is also why this item needs no debug operation to set a unit's health. A case whose
// units carry a fraction-of-maximum health bar has the opposite problem — two units at full
// health draw the same full bar however far apart their totals are — and has to wound one
// explicitly to pose a visible difference. Valence draws the count itself, so posing the
// difference is posing the unit.
//
// A is the scene's rearmost atom too, so `strongest` and `last` land on the same one here;
// see the note in `targeting/last.mjs` for why breaking that overlap would cost more than it
// buys. What separates them is `weakest`, which must NOT be the frontmost atom — and is not:
// B is the 1-electron atom in the middle of the scene.

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

  return {
    id: "targeting.strongest",

    async arrange(api) {
      scene = await poseTargetingScene(api, startScenario, "strongest");
    },

    async act(api) {
      result = await actTargetingPick(api, scene);

      // Remaining hit points at the instant the graded shot was launched. The Beam has been
      // firing since the clip opened, so what matters is the standing that held then, not
      // the electron counts the scene was posed with.
      hp = Object.fromEntries(
        [scene.A, scene.B, scene.C].map((id) => [
          id,
          unitById(result.snap, id)?.hp ?? null,
        ]),
      );
    },

    async assert(api, check) {
      check.expectOk(
        "the posed strong atom really did hold the most hit points when the shot was taken",
        hp[scene.A] != null &&
          hp[scene.B] != null &&
          hp[scene.C] != null &&
          hp[scene.A] > hp[scene.B] &&
          hp[scene.A] > hp[scene.C],
      );
      checkTargetingPick(check, {
        label: "STRONGEST",
        result,
        pick: scene.A,
      });
    },
  };
}
