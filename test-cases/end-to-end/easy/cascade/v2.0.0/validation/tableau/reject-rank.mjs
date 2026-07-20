// Automated validation for the Tableau sub-item `reject-rank`.
//
// A tableau build must be exactly one lower in rank: an opposite-color card that is
// not the next-lower rank is rejected. A red 5 onto a black 7 (opposite color, but
// two lower) must not be accepted. The real move runs and the column is read back.

import { card, pose, shoot } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("tableau.reject-rank");

  await pose(api, { tableau: [[card("spades", 7, true)]], waste: [card("hearts", 5, true)] }, 1);
  const rejected = await api.call("move", { pile: "waste" }, { pile: "tableau", column: 0 });
  const s = await api.snapshot();

  check.expectEq("a red 5 is rejected onto a black 7 (wrong rank)", rejected, false);
  check.expectEq("the column is unchanged (still just the 7)", s.tableau[0].length, 1);

  await shoot(api, "rank");
  return check.verdict();
}
