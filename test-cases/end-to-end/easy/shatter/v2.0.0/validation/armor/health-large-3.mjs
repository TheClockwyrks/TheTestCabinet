// Automated validation (Warhead) for the Armor item `health-large-3`: a Large rock takes
// three bullet hits to destroy. A single Large is posed on an empty field and shot with the
// primary gun until it is gone; the number of hits it took is read back.
//
// Posing the isolated rock is instant, so it is `arrange`; firing at it until it dies is what
// consumes time, so it is `act` — and that exchange IS the clip.

import { arrangePosedRock, actFireUntilGone } from "../_helpers.mjs";

export default function item() {
  // What the shots achieved, read by `assert`.
  let outcome;

  return {
    id: "armor.health-large-3",

    async arrange(api) {
      await arrangePosedRock(api, "large");
    },

    async act(api) {
      outcome = await actFireUntilGone(api, "large");
    },

    async assert(api, check) {
      check.expectEq(
        "a Large rock takes three bullet hits to destroy",
        outcome.hits,
        3,
      );
      check.expectEq(
        "destroying it splits it into two Medium rocks",
        outcome.snap.rocks.filter((r) => r.size === "medium").length,
        2,
      );
    },
  };
}
