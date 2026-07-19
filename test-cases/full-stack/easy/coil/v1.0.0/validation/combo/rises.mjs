// Automated validation for the Combo sub-item `rises`.
//
// Eating pellets in quick succession, while the combo window is open, raises the
// multiplier by one per pellet. Four pellets are eaten one tick apart in a clear lane
// (each placed one cell ahead as a precondition, then a real tick runs the head into
// it); the multiplier after each real eat is read back. The first eat opens the window
// at x1; each subsequent eat within it climbs by one.

import { eatSequence, hLane, liveClip, beginRound } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("combo.rises");

  await beginRound(api);
  const { combos } = await eatSequence(api, { count: 4 });

  check.expectEq("first eat (window opens) is x1", combos[0], 1);
  check.expectEq("second quick eat climbs to x2", combos[1], 2);
  check.expectEq("third quick eat climbs to x3", combos[2], 3);
  check.expectEq("fourth quick eat climbs to x4", combos[3], 4);

  await liveClip(api, { snake: hLane(3, 8, 3), pellet: { col: 4, row: 8 } });
  return check.verdict();
}
