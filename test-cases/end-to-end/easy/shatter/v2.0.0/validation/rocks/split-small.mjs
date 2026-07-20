// Automated validation for the Rocks item `split-small`: a Small rock is destroyed
// outright, leaving no fragment. A single Small is posed on an empty field and shot
// until destroyed; the field must then be empty.
//
// Posing the isolated rock is instant (`arrange`); firing at it until it is gone is what
// consumes time (`act`), so the clip is the shot that clears the field.

import { arrangePosedRock, actFireUntilGone } from "../_helpers.mjs";

export default function item() {
  // The field just after the Small died, read by `assert`.
  let outcome;

  return {
    id: "rocks.split-small",

    async arrange(api) {
      await arrangePosedRock(api, "small");
    },

    async act(api) {
      outcome = await actFireUntilGone(api, "small");
    },

    async assert(api, check) {
      check.expectEq(
        "a destroyed Small leaves no fragments — the field is empty",
        outcome.snap.rocks.length,
        0,
      );
    },
  };
}
