// Automated validation for the Deal sub-item `reshuffled`.
//
// Every new game is reshuffled, so two deals differ; the shuffle draws from a
// seedable generator (specs/instrumentation.md), so the SAME seed reproduces the
// same deal. Two different seeds must produce different tableaux, and re-dealing
// the first seed must reproduce its tableau exactly.

import { deal, serializeTableau, shoot } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("deal.reshuffled");

  const a = serializeTableau(await deal(api, 1));
  const b = serializeTableau(await deal(api, 2));
  const aAgain = serializeTableau(await deal(api, 1));

  check.expectNe("two different seeds deal different tableaux (reshuffled)", a, b);
  check.expectEq("the same seed reproduces the same deal (seeded shuffle)", aAgain, a);

  await shoot(api, "deal");
  return check.verdict();
}
