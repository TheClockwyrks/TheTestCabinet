// Automated validation for the Scoring item `small-100`: destroying a Small rock scores
// 100. A single Small is posed on an empty field (score 0) and destroyed; the score is
// read back.

import { poseAndDestroy, ROCK_SCORE } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("scoring.small-100");

  const { snap } = await poseAndDestroy(api, "small");
  check.expectEq("destroying a Small rock scores 100", snap.score, ROCK_SCORE.small);

  await api.call("setAutoStep", true);
  await api.wait(600);
  return check.verdict();
}
