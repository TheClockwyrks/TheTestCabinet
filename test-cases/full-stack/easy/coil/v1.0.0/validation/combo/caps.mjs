// Automated validation for the Combo sub-item `caps`.
//
// The multiplier never exceeds x5. The multiplier is set to x5 with an open window as
// a precondition (setCombo), the snake is posed with a pellet one cell ahead, and one
// real tick runs the head into it — the real combo code, not the precondition, decides
// the result, which must stay x5.

import { TICK_DT, hLane, liveClip, beginRound, COMBO_WINDOW } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("combo.caps");

  await beginRound(api);
  await api.call("setSnake", hLane(10, 8, 3), "right");
  await api.call("setPellet", { col: 11, row: 8 }); // one cell ahead
  await api.call("setCombo", 5, COMBO_WINDOW); // already at the cap, window open

  check.expectEq("the precondition set the multiplier to x5", (await api.snapshot()).combo, 5);

  await api.step(TICK_DT); // eat while at x5
  const s = await api.snapshot();
  check.expectEq("eating at x5 leaves the multiplier at x5 (capped)", s.combo, 5);
  check.expectEq("the eat still happened (snake grew)", s.length, 4);

  await liveClip(api, { snake: hLane(3, 8, 3), pellet: { col: 4, row: 8 } });
  return check.verdict();
}
