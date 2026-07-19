// Automated validation for the Winning sub-item `detect`.
//
// Completing all four foundations (all 52 cards home) is detected as a win: normal
// play stops and the victory cascade begins. The board is posed one card short of a
// win and that last card is moved home through the real move op, so the game's own
// win check fires. The pre- and post-move snapshots confirm the transition, then a
// live clip shows the cascade starting.

import { card, suitRun } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("winning.detect");

  await api.reset({ seed: 2 });
  await api.call("setBoard", {
    foundations: [suitRun("spades", 1, 12), suitRun("hearts", 1, 13), suitRun("diamonds", 1, 13), suitRun("clubs", 1, 13)],
    waste: [card("spades", 13, true)],
  });

  const before = await api.snapshot();
  check.expectEq("play is live before the last card goes home", before.screen, "playing");
  check.expectEq("not yet won", before.won, false);

  // The final card home completes the last foundation.
  await api.call("move", { pile: "waste" }, { pile: "foundation", index: 0 });
  const after = await api.snapshot();
  check.expectEq("all 52 home is detected as a win", after.won, true);
  check.expectEq("normal play stops (the won screen)", after.screen, "won");
  check.expectNe("the victory cascade has begun", after.cascade, null);

  // A live clip of the cascade launching.
  await api.call("setAutoStep", true);
  await api.wait(2500);

  return check.verdict();
}
