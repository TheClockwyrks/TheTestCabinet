// Automated validation for the Scoring item `bay`.
//
// Reaching a bay scores fifty points plus a per-second bonus for the time left on
// the crossing timer. The critter climbs a safe corridor to just below a bay (so
// bestRow tracks naturally), the timer is set to a known value, and the score
// delta of the real bay-filling hop is read back: 10 (final row) + 50 + 2*floor(T).
// See validation/_helpers.mjs.

import { startCrossing, poseClimb, buildSafeColumn, climbByPress } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("scoring.bay");

  await startCrossing(api);
  await api.call("setScore", 0);
  await poseClimb(api, 11); // bay 1 column
  await climbByPress(api, "ArrowUp", 2); // climb to just below the bay
  await api.call("setTimer", 10);
  const before = (await api.snapshot()).score;
  await api.call("press", "ArrowUp"); // fill bay 1
  await api.step(0.2);
  const s = await api.snapshot();
  check.expectEq("the crossing filled bay 1", s.bays[1], true);
  // 10 (row) + 50 (bay) + 2*floor(T) (time, T~=10). The per-second time term may
  // land one second either way depending on the exact sub-second the fill resolves,
  // so the delta is checked within one time-bonus unit.
  check.expectClose("a bay scores row(10) + 50 + a per-second time bonus", s.score - before, 10 + 50 + 2 * 10, 3);

  // Clip: the climb and the bay fill in real time.
  await startCrossing(api);
  await buildSafeColumn(api, 11);
  await api.call("placeCritter", 11, 19);
  await api.call("keyDown", "ArrowUp");
  await api.wait(2600);
  await api.call("keyUp", "ArrowUp");
  await api.wait(400);

  return check.verdict();
}
