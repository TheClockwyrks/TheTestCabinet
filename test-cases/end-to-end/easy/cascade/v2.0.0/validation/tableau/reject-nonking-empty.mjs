// Automated validation for the Tableau sub-item `reject-nonking-empty`.
//
// Only a King may start an empty column: any lower card is rejected there. A Queen
// onto an empty column must not be accepted. The real move runs and the still-empty
// column is read back.

import { card, pose, shoot } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("tableau.reject-nonking-empty");

  await pose(api, { waste: [card("spades", 12, true)] }, 1);
  const rejected = await api.call("move", { pile: "waste" }, { pile: "tableau", column: 0 });
  const s = await api.snapshot();

  check.expectEq("a Queen is rejected onto an empty column", rejected, false);
  check.expectEq("the column stays empty", s.tableau[0].length, 0);
  check.expectEq("the Queen stays on the waste", s.waste.length, 1);

  await shoot(api, "nonking");
  return check.verdict();
}
