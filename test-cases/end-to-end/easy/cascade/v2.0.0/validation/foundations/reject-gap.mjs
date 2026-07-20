// Automated validation for the Foundations sub-item `reject-gap`.
//
// A foundation builds up strictly by one: a same-suit card that skips a rank is
// rejected. On the Ace of spades, the 3 of spades (same suit, but not the next
// rank) must not be accepted. The real move runs and the unchanged pile is read.

import { card, pose, shoot } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("foundations.reject-gap");

  await pose(api, { foundations: [[card("spades", 1)]], waste: [card("spades", 3, true)] }, 1);
  const rejected = await api.call("move", { pile: "waste" }, { pile: "foundation", index: 0 });
  const s = await api.snapshot();

  check.expectEq("the 3 of spades is rejected onto the Ace (skips the 2)", rejected, false);
  check.expectEq("the foundation is unchanged (still just the Ace)", s.foundations[0].length, 1);

  await shoot(api, "gap");
  return check.verdict();
}
