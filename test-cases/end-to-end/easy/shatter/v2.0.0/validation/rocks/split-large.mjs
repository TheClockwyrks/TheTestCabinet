// Automated validation for the Rocks item `split-large`: destroying a Large rock yields
// two Medium rocks. A single Large is posed on an empty field and shot until destroyed
// (one bullet in the base game, or however many its armor takes in Warhead); the field
// is then read for the two Medium fragments.
//
// Posing the isolated rock is instant (`arrange`); firing at it until it splits is what
// consumes time (`act`), so the clip is the shot and the split it produces.

import { arrangePosedRock, actFireUntilGone } from "../_helpers.mjs";

export default function item() {
  // The field just after the Large died, read by `assert`.
  let outcome;

  return {
    id: "rocks.split-large",

    async arrange(api) {
      await arrangePosedRock(api, "large");
    },

    async act(api) {
      outcome = await actFireUntilGone(api, "large");
    },

    async assert(api, check) {
      const mediums = outcome.snap.rocks.filter((r) => r.size === "medium");
      const larges = outcome.snap.rocks.filter((r) => r.size === "large");

      check.expectEq("the Large rock is gone once destroyed", larges.length, 0);
      check.expectEq(
        "a destroyed Large yields exactly two Medium rocks",
        mediums.length,
        2,
      );
    },
  };
}
