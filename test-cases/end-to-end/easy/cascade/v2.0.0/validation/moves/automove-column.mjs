// Automated validation for the Auto-move-and-flip sub-item `automove-column`.
//
// Double-clicking a column's bottom face-up card sends it straight to its
// foundation when legal. The 2 of hearts on a column, with the Ace of hearts home,
// auto-moves onto the foundation. The real auto-move runs and the piles are read.

import { card, pose, shoot } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("moves.automove-column");

  await pose(api, { foundations: [[], [card("hearts", 1)]], tableau: [[card("hearts", 2, true)]] }, 1);
  const ok = await api.call("autoMove", { pile: "tableau", column: 0 });
  const s = await api.snapshot();

  check.expectEq("a column's bottom card auto-moves home when legal", ok, true);
  check.expectEq("the hearts foundation grew to two cards", s.foundations[1].length, 2);
  check.expectEq("its top card is the 2", s.foundations[1][s.foundations[1].length - 1].rank, 2);
  check.expectEq("the source column is now empty", s.tableau[0].length, 0);

  await shoot(api, "column");
  return check.verdict();
}
