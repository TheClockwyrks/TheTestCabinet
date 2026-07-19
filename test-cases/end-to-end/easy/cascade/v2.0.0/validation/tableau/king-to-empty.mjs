// Automated validation for the Tableau sub-item `king-to-empty`.
//
// Only a King may be moved onto an empty column. A King is accepted onto an empty
// column. The real move runs and the column is read back.

import { card, pose, shoot } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("tableau.king-to-empty");

  // Column 0 is empty (no tableau given); a King is on the waste.
  await pose(api, { waste: [card("spades", 13, true)] }, 1);
  const ok = await api.call("move", { pile: "waste" }, { pile: "tableau", column: 0 });
  const s = await api.snapshot();

  check.expectEq("a King is accepted onto an empty column", ok, true);
  check.expectEq("the column now holds one card", s.tableau[0].length, 1);
  check.expectEq("that card is the King", s.tableau[0][0].rank, 13);

  await shoot(api, "king");
  return check.verdict();
}
