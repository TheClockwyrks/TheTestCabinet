// Automated validation for the Foundations sub-item `build-up`.
//
// A foundation builds up by suit: on an Ace it accepts the next-higher card of the
// same suit (the 2), and on the 2 the 3, and so on. The real move runs and the
// growing pile is read back.

import { card, pose, shoot } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("foundations.build-up");

  // Foundation 0 holds the Ace of spades; the 2 of spades is on the waste.
  await pose(api, { foundations: [[card("spades", 1)]], waste: [card("spades", 2, true)] }, 1);
  const twoOk = await api.call("move", { pile: "waste" }, { pile: "foundation", index: 0 });
  let s = await api.snapshot();
  check.expectEq("the 2 of spades is accepted onto the Ace", twoOk, true);
  check.expectEq("the foundation now holds two cards", s.foundations[0].length, 2);
  check.expectEq("its top card is the 2", s.foundations[0][s.foundations[0].length - 1].rank, 2);

  // And the 3 of spades onto the 2.
  await api.call("setBoard", { foundations: [[card("spades", 1), card("spades", 2)]], waste: [card("spades", 3, true)] });
  const threeOk = await api.call("move", { pile: "waste" }, { pile: "foundation", index: 0 });
  s = await api.snapshot();
  check.expectEq("the 3 of spades is accepted onto the 2", threeOk, true);
  check.expectEq("its top card is now the 3", s.foundations[0][s.foundations[0].length - 1].rank, 3);

  await shoot(api, "build");
  return check.verdict();
}
