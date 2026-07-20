// Automated validation for the Auto-move-and-flip sub-item `automove-illegal`.
//
// Auto-move does nothing when there is no legal foundation for the card. A 5 with
// no matching foundation started stays where it is. The real auto-move runs and the
// unchanged board is read back.

import { card, pose, shoot } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("moves.automove-illegal");

  // No foundations started, so a 5 has no legal home.
  await pose(api, { tableau: [[card("spades", 5, true)]] }, 1);
  const ok = await api.call("autoMove", { pile: "tableau", column: 0 });
  const s = await api.snapshot();

  check.expectEq("the auto-move does nothing with no legal foundation", ok, false);
  check.expectEq("the card stays in its column", s.tableau[0].length, 1);
  check.expectEq("it is still the 5", s.tableau[0][0].rank, 5);
  for (let i = 0; i < 4; i += 1) {
    check.expectEq(`foundation ${i + 1} is still empty`, s.foundations[i].length, 0);
  }

  await shoot(api, "illegal");
  return check.verdict();
}
