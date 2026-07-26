// Automated validation for the Deal sub-item `reshuffled`.
//
// Every new game is reshuffled, so two deals differ; the shuffle draws from a
// seedable generator (specs/instrumentation.md), so the SAME seed reproduces the
// same deal. Two different seeds must produce different tableaux, and re-dealing
// the first seed must reproduce its tableau exactly.
//
// All three deals are instant and each begins with a `reset`, which only `arrange`
// may call, so the comparison is posed there. `act` films the board left standing —
// the re-deal of seed 1, the tableau whose reproduction the last assertion checks.

import { actShoot, deal, serializeTableau } from "../_helpers.mjs";

export default function item() {
  // The three tableaux, in stable string form, for `assert` to compare.
  let a;
  let b;
  let aAgain;

  return {
    id: "deal.reshuffled",

    async arrange(api) {
      a = serializeTableau(await deal(api, 1));
      b = serializeTableau(await deal(api, 2));
      aAgain = serializeTableau(await deal(api, 1));
    },

    async act(api) {
      await actShoot(api, "deal");
    },

    async assert(api, check) {
      check.expectNe(
        "two different seeds deal different tableaux (reshuffled)",
        a,
        b,
      );
      check.expectEq(
        "the same seed reproduces the same deal (seeded shuffle)",
        aAgain,
        a,
      );
    },
  };
}
