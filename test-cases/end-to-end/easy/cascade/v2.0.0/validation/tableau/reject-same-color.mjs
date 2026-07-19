// Automated validation for the Tableau sub-item `reject-same-color`.
//
// A tableau build must alternate color: a one-lower card of the SAME color is
// rejected. A black 6 onto a black 7 (right rank, same color) must not be
// accepted. The real move runs and the unchanged column is read back.

import { card, pose, shoot } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("tableau.reject-same-color");

  await pose(api, { tableau: [[card("spades", 7, true)]], waste: [card("clubs", 6, true)] }, 1);
  const rejected = await api.call("move", { pile: "waste" }, { pile: "tableau", column: 0 });
  const s = await api.snapshot();

  check.expectEq("a black 6 is rejected onto a black 7 (same color)", rejected, false);
  check.expectEq("the column is unchanged (still just the 7)", s.tableau[0].length, 1);
  check.expectEq("the 6 stays on the waste", s.waste.length, 1);

  await shoot(api, "same-color");
  return check.verdict();
}
