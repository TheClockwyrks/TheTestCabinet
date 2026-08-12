// Automated validation (Warhead) for the Rocks item (Warhead armor) `health-small-1`: a Small rock takes a
// single bullet hit to destroy. A single Small is posed on an empty field and shot with the
// primary gun until it is gone; the number of hits it took is read back.
//
// Posing the isolated rock is instant, so it is `arrange`; firing at it until it dies is what
// consumes time, so it is `act` — and that shot IS the clip, so the reviewer watches the same
// kill whose hit count decides the verdict.

import { arrangePosedRock, actFireUntilGone } from "../_helpers.mjs";

export default function item() {
  // What the shots achieved, read by `assert`.
  let outcome;

  return {
    id: "rocks.health-small-1",

    async arrange(api) {
      await arrangePosedRock(api, "small");
    },

    async act(api) {
      outcome = await actFireUntilGone(api, "small");
    },

    async assert(api, check) {
      check.expectEq(
        "a Small rock takes one bullet hit to destroy",
        outcome.hits,
        1,
      );
      check.expectEq(
        "a destroyed Small leaves no fragments",
        outcome.snap.rocks.length,
        0,
      );
    },
  };
}
