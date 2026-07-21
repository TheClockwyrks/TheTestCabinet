// Automated validation for the Rocks item `split-medium`: destroying a Medium rock
// yields two Small rocks. A single Medium is posed on an empty field and shot until
// destroyed; the field is then read for the two Small fragments.
//
// Posing the isolated rock is instant (`arrange`); firing at it until it splits is what
// consumes time (`act`), so the clip is the shot and the split it produces.

import { arrangePosedRock, actFireUntilGone } from "../_helpers.mjs";

export default function item() {
  // The field just after the Medium died, read by `assert`.
  let outcome;

  return {
    id: "rocks.split-medium",

    async arrange(api) {
      await arrangePosedRock(api, "medium");
    },

    async act(api) {
      outcome = await actFireUntilGone(api, "medium");
    },

    async assert(api, check) {
      const smalls = outcome.snap.rocks.filter((r) => r.size === "small");
      const mediums = outcome.snap.rocks.filter((r) => r.size === "medium");

      check.expectEq(
        "the Medium rock is gone once destroyed",
        mediums.length,
        0,
      );
      check.expectEq(
        "a destroyed Medium yields exactly two Small rocks",
        smalls.length,
        2,
      );
    },
  };
}
