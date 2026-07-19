// Automated validation for the Scoring item `level-clear`.
//
// Clearing a level awards a bonus of one hundred points times the level, on top of
// the bay it was filled with. With four bays pre-filled, the critter climbs to just
// below the fifth bay and fills it; the score delta of that real hop is
// 10 (row) + 50 (bay) + 2*floor(T) (time) + 100*level (the clear). See _helpers.mjs.

import { startCrossing, poseClimb, buildSafeColumn, climbByPress } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("scoring.level-clear");

  await startCrossing(api);
  await api.call("setScore", 0);
  await api.call("setBays", [true, true, true, true, false]);
  await poseClimb(api, 35); // bay 4 column
  await climbByPress(api, "ArrowUp", 2);
  await api.call("setTimer", 10);
  const before = (await api.snapshot()).score;
  await api.call("press", "ArrowUp"); // fill the fifth bay -> clear the level
  await api.step(0.2);
  const s = await api.snapshot();
  check.expectGt("clearing a level scores more than a plain bay", s.score - before, 80);
  // 10 (row) + 50 (bay) + 2*floor(T) (time, T~=10) + 100*level (the clear). The
  // per-second time term may land one second either way depending on the exact
  // sub-second the fill resolves, so the delta is checked within one time-bonus unit.
  check.expectClose("the clear adds row(10) + bay(50+time) + 100*level", s.score - before, 10 + 50 + 2 * 10 + 100 * 1, 3);

  // Clip: the clearing fill and the level-clear banner in real time.
  await startCrossing(api);
  await api.call("setBays", [true, true, true, true, false]);
  await buildSafeColumn(api, 35);
  await api.call("placeCritter", 35, 19);
  await api.call("keyDown", "ArrowUp");
  await api.wait(2600);
  await api.call("keyUp", "ArrowUp");
  await api.wait(1600);

  return check.verdict();
}
