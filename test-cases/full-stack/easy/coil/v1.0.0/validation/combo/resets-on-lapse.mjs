// Automated validation for the Combo sub-item `resets-on-lapse`.
//
// Wandering without eating until the combo window lapses drops the multiplier back to
// x1 and closes the window. The multiplier is raised to x2 by two real eats, then the
// snake wanders for well over the 3.5 s window without eating (driftTicks steps single
// ticks, repositioning to a clear lane and parking the pellet so nothing is eaten and
// the snake never dies — combo state is untouched, so the real window drain resolves
// the reset). The final multiplier and window are read back.

import {
  eatSequence,
  driftTicks,
  hLane,
  liveClip,
  beginRound,
} from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("combo.resets-on-lapse");

  await beginRound(api);
  const { combos } = await eatSequence(api, { count: 2 });
  check.expectGe("two quick eats raised the multiplier to at least x2", combos[1], 2);

  // Wander 32 ticks (4.0 s) — comfortably past the 3.5 s window — without eating.
  const snaps = await driftTicks(api, 32);
  const last = snaps[snaps.length - 1];
  check.expectEq("the multiplier reset to x1 after the window lapsed", last.combo, 1);
  check.expectEq("the combo window is closed", last.comboWindow, 0);

  await liveClip(api, { snake: hLane(3, 8, 3), pellet: { col: 4, row: 8 } });
  return check.verdict();
}
