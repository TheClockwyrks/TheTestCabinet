// Automated validation for the Auto-move-and-flip sub-item `automove-waste`.
//
// Double-clicking the top of the waste sends it straight to its foundation when
// that move is legal. The 2 of spades on the waste, with the Ace of spades home,
// auto-moves onto the foundation. The real auto-move runs and the piles are read.

import { card, pose, shoot } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("moves.automove-waste");

  await pose(api, { foundations: [[card("spades", 1)]], waste: [card("spades", 2, true)] }, 1);
  const ok = await api.call("autoMove", { pile: "waste" });
  const s = await api.snapshot();

  check.expectEq("the waste's top card auto-moves home when legal", ok, true);
  check.expectEq("the foundation grew to two cards", s.foundations[0].length, 2);
  check.expectEq("its top card is the 2", s.foundations[0][s.foundations[0].length - 1].rank, 2);
  check.expectEq("the waste is now empty", s.waste.length, 0);

  await shoot(api, "waste");
  return check.verdict();
}
