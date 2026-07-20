// Automated validation for the Victory-cascade sub-item `you-win`.
//
// The cascade ends with a YOU WIN prompt, and a click starts a fresh game (specs/
// victory.md, specs/states.md). The sim is run to completion under the manual clock,
// the win prompt state is read back, and then a real click (injected pointer input)
// is confirmed to deal a new game. The waits hold the video output on the prompt and
// then the new deal.

import { winBoard } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("cascade.you-win");

  await winBoard(api, 13);
  await api.step(40); // run the whole cascade to completion
  const done = await api.snapshot();
  check.expectEq("the cascade completed", done.cascade.done, true);
  check.expectEq("the YOU WIN prompt is showing", done.cascade.youWin, true);
  check.expectEq("still on the won screen", done.screen, "won");

  await api.wait(1400); // hold on the YOU WIN prompt for the clip

  // A click starts a fresh game.
  await api.call("click", 640, 360);
  const after = await api.snapshot();
  check.expectEq("a click starts a new game", after.screen, "playing");
  check.expectEq("a fresh game is dealt (24 in the stock)", after.stock.length, 24);

  await api.wait(700); // hold on the fresh deal for the clip

  return check.verdict();
}
