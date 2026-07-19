// Automated validation for the Foundations sub-item `reject-offsuit`.
//
// A foundation is a single suit: a next-rank card of the WRONG suit is rejected.
// On the Ace of spades, the 2 of hearts (right rank, wrong suit) must not be
// accepted. The real move runs and the unchanged pile is read back.

import { card, pose, shoot } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("foundations.reject-offsuit");

  await pose(api, { foundations: [[card("spades", 1)]], waste: [card("hearts", 2, true)] }, 1);
  const rejected = await api.call("move", { pile: "waste" }, { pile: "foundation", index: 0 });
  const s = await api.snapshot();

  check.expectEq("the 2 of hearts is rejected onto the Ace of spades (wrong suit)", rejected, false);
  check.expectEq("the foundation is unchanged (still just the Ace)", s.foundations[0].length, 1);
  check.expectEq("the 2 of hearts stays on the waste", s.waste.length, 1);

  await shoot(api, "offsuit");
  return check.verdict();
}
