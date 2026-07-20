// Automated validation for the Foundations sub-item `ace-only`.
//
// An empty foundation accepts only an Ace and rejects any other rank. Each move is
// the real legal-move check + apply (the same path a drag release uses); the board
// is read back to confirm what the real rules allowed.

import { card, pose, shoot } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("foundations.ace-only");

  // A non-Ace is rejected onto an empty foundation.
  await pose(api, { waste: [card("hearts", 5, true)] }, 1);
  const rejected = await api.call("move", { pile: "waste" }, { pile: "foundation", index: 0 });
  let s = await api.snapshot();
  check.expectEq("a 5 is rejected onto an empty foundation", rejected, false);
  check.expectEq("the rejected foundation stays empty", s.foundations[0].length, 0);

  // An Ace is accepted onto an empty foundation.
  await pose(api, { waste: [card("spades", 1, true)] }, 1);
  const accepted = await api.call("move", { pile: "waste" }, { pile: "foundation", index: 0 });
  s = await api.snapshot();
  check.expectEq("an Ace is accepted onto an empty foundation", accepted, true);
  check.expectEq("the foundation now holds one card", s.foundations[0].length, 1);
  check.expectEq("that card is the Ace", s.foundations[0][0].rank, 1);

  await shoot(api, "ace");
  return check.verdict();
}
