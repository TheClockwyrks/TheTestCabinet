// Automated validation (Warhead) for the Armor item `fragment-full-health`: rocks created
// by a split enter at full health for their size. A Large is destroyed with the primary gun;
// the two Medium fragments must each carry full Medium health (2), not the parent's chipped
// value.
//
// Posing the isolated Large is instant, so it is `arrange`; chipping it down and killing it is
// what consumes time, so it is `act` — the clip shows the parent take its three hits and the
// fragments enter fresh.

import { arrangePosedRock, actFireUntilGone } from "../_helpers.mjs";

export default function item() {
  // The state just after the Large died, read by `assert`.
  let outcome;

  return {
    id: "armor.fragment-full-health",

    async arrange(api) {
      await arrangePosedRock(api, "large");
    },

    async act(api) {
      outcome = await actFireUntilGone(api, "large");
    },

    async assert(api, check) {
      const mediums = outcome.snap.rocks.filter((r) => r.size === "medium");

      check.expectEq(
        "the destroyed Large yields two Medium fragments",
        mediums.length,
        2,
      );
      if (mediums.length === 2) {
        check.expectEq(
          "the first fragment enters at full Medium health (2)",
          mediums[0].health,
          2,
        );
        check.expectEq(
          "the second fragment enters at full Medium health (2)",
          mediums[1].health,
          2,
        );
      }
    },
  };
}
