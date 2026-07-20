// Automated validation for the Deal sub-item `empties`.
//
// A fresh deal leaves the waste and all four foundations empty (only the tableau
// and the stock hold cards). The real deal runs and the piles are read back.

import { deal, shoot } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("deal.empties");

  const s = await deal(api, 12);

  check.expectEq("the waste is empty after the deal", s.waste.length, 0);
  for (let i = 0; i < 4; i += 1) {
    check.expectEq(`foundation ${i + 1} is empty after the deal`, s.foundations[i].length, 0);
  }

  await shoot(api, "empties");
  return check.verdict();
}
