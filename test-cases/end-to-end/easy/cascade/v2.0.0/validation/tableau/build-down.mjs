// Automated validation for the Tableau sub-item `build-down`.
//
// A tableau column builds down in rank and alternates color: a card is accepted
// only onto a face-up card one rank higher and of the opposite color. A red 6 onto
// a black 7 is legal. The real move runs and the column is read back.

import { card, pose, shoot } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("tableau.build-down");

  // Column 0 exposes a black 7; a red 6 is on the waste.
  await pose(api, { tableau: [[card("spades", 7, true)]], waste: [card("hearts", 6, true)] }, 1);
  const ok = await api.call("move", { pile: "waste" }, { pile: "tableau", column: 0 });
  const s = await api.snapshot();

  check.expectEq("the red 6 is accepted onto the black 7", ok, true);
  check.expectEq("the column now holds two cards", s.tableau[0].length, 2);
  const top = s.tableau[0][s.tableau[0].length - 1];
  check.expectEq("its new bottom card is the 6", top.rank, 6);
  check.expectEq("of the opposite (red) color", top.color, "red");

  await shoot(api, "build");
  return check.verdict();
}
