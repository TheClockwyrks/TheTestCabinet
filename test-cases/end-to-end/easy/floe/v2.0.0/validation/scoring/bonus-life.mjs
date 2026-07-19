// Automated validation for the Scoring item `bonus-life`.
//
// Crossing a 10,000-point milestone awards an extra life. The critter climbs to
// just below a bay, the score is set to 9,990 (next milestone at 10,000), and the
// real bay-filling hop pushes the score across the milestone through the normal
// scoring path — awarding a life, which the snapshot reads back. See _helpers.mjs.

import { startCrossing, poseClimb, buildSafeColumn, climbByPress } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("scoring.bonus-life");

  await startCrossing(api);
  await api.call("setLives", 3);
  await poseClimb(api, 11);
  await climbByPress(api, "ArrowUp", 2);
  await api.call("setScore", 9990); // next bonus life at 10,000
  const before = (await api.snapshot()).lives;
  await api.call("press", "ArrowUp"); // fill the bay -> score crosses 10,000
  await api.step(0.2);
  const s = await api.snapshot();
  check.expectGe("the score crossed the 10,000-point milestone", s.score, 10000);
  check.expectEq("crossing the milestone awards a life", s.lives, before + 1);

  // Clip: the crossing that tips the score over the milestone, in real time.
  await startCrossing(api);
  await buildSafeColumn(api, 11);
  await api.call("placeCritter", 11, 19);
  await api.call("setScore", 9800);
  await api.call("keyDown", "ArrowUp");
  await api.wait(2600);
  await api.call("keyUp", "ArrowUp");
  await api.wait(400);

  return check.verdict();
}
