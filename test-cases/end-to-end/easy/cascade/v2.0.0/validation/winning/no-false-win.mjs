// Automated validation for the Winning sub-item `no-false-win`.
//
// The win fires only when EVERY foundation is complete: 51 cards home is not a win.
// The board is posed at 50 home and one card is moved home to reach 51 (the last
// foundation still one short), through the real move op, so the real win check runs
// and must return false. The post-move snapshot confirms play continues.

import { card, suitRun } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("winning.no-false-win");

  // Spades and hearts complete; diamonds and clubs one short each (50 home).
  await api.reset({ seed: 3 });
  await api.call("setBoard", {
    foundations: [suitRun("spades", 1, 13), suitRun("hearts", 1, 13), suitRun("diamonds", 1, 12), suitRun("clubs", 1, 12)],
    waste: [card("diamonds", 13, true)],
  });

  // Send the King of diamonds home: diamonds complete (51 total), clubs still short.
  const ok = await api.call("move", { pile: "waste" }, { pile: "foundation", index: 2 });
  const s = await api.snapshot();

  check.expectEq("the 51st card went home", ok, true);
  const total = s.foundations.reduce((n, f) => n + f.length, 0);
  check.expectEq("51 cards are home", total, 51);
  check.expectEq("51 home is NOT a win", s.won, false);
  check.expectEq("play continues", s.screen, "playing");
  check.expectEq("no victory cascade has started", s.cascade, null);

  await api.wait(90);
  await api.screenshot("not-won");
  return check.verdict();
}
