// Automated validation for the Scoring item `large-20`: destroying a Large rock scores
// 20. A single Large is posed on an empty field (score 0) and destroyed with the primary
// gun; the score is read back — only the destroying hit scores.

import { poseAndDestroy, ROCK_SCORE } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("scoring.large-20");

  const { snap } = await poseAndDestroy(api, "large");
  check.expectEq("destroying a Large rock scores 20", snap.score, ROCK_SCORE.large);

  await api.call("setAutoStep", true);
  await api.wait(600);
  return check.verdict();
}
