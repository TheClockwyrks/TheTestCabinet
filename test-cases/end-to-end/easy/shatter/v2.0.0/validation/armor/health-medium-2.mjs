// Automated validation (Warhead) for the Armor item `health-medium-2`: a Medium rock takes
// two bullet hits to destroy. A single Medium is posed on an empty field and shot with the
// primary gun until it is gone; the number of hits it took is read back.
//
// Posing the isolated rock is instant, so it is `arrange`; firing at it until it dies is what
// consumes time, so it is `act` — and that exchange IS the clip.

import { arrangePosedRock, actFireUntilGone } from "../_helpers.mjs";

export default function item() {
  // What the shots achieved, read by `assert`.
  let outcome;

  return {
    id: "armor.health-medium-2",

    async arrange(api) {
      await arrangePosedRock(api, "medium");
    },

    async act(api) {
      outcome = await actFireUntilGone(api, "medium");
    },

    async assert(api, check) {
      check.expectEq(
        "a Medium rock takes two bullet hits to destroy",
        outcome.hits,
        2,
      );
      check.expectEq(
        "destroying it splits it into two Small rocks",
        outcome.snap.rocks.filter((r) => r.size === "small").length,
        2,
      );
    },
  };
}
