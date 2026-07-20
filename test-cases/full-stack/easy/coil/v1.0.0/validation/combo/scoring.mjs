// Automated validation for the Combo sub-item `scoring`.
//
// Each pellet scores 10 x M using the multiplier AFTER this eat raises it. From score
// 0 at x3 with an open window (both set as preconditions), one real eat within the
// window raises the multiplier to x4 and scores 10 x 4 = 40; the multiplier and score
// are read back from the real tick.

import { TICK_DT, hLane, liveClip, beginRound, COMBO_WINDOW } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("combo.scoring");

  await beginRound(api);
  await api.call("setSnake", hLane(10, 8, 3), "right");
  await api.call("setPellet", { col: 11, row: 8 }); // one cell ahead
  await api.call("setScore", 0);
  await api.call("setCombo", 3, COMBO_WINDOW); // x3, window open

  await api.step(TICK_DT); // eat within the window
  const s = await api.snapshot();

  check.expectEq("the eat raised the multiplier to x4", s.combo, 4);
  check.expectEq("the pellet scored 10 x 4 = 40 (updated multiplier)", s.score, 40);

  await liveClip(api, { snake: hLane(3, 8, 3), pellet: { col: 4, row: 8 } });
  return check.verdict();
}
