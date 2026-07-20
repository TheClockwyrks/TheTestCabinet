// Automated validation for the Scoring item `medium-50`: destroying a Medium rock scores
// 50. A single Medium is posed on an empty field (score 0) and destroyed; the score is
// read back.

import { poseAndDestroy, ROCK_SCORE } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("scoring.medium-50");

  const { snap } = await poseAndDestroy(api, "medium");
  check.expectEq("destroying a Medium rock scores 50", snap.score, ROCK_SCORE.medium);

  await api.call("setAutoStep", true);
  await api.wait(600);
  return check.verdict();
}
