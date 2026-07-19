// Automated validation for the Scoring item `monotonic`: over a driven kill sequence the
// HUD score only ever rises. Three Small rocks are destroyed one after another on an empty
// field; the score is sampled after each and must climb strictly through 100, 200, 300.

import { newGame, fireUntilGone, ROCK_SCORE, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("scoring.monotonic");

  await newGame(api);
  await api.call("setScore", 0);

  const scores = [];
  for (let i = 0; i < 3; i += 1) {
    await api.call("addRock", "small", { x: 400, y: 250, vx: 0, vy: 0 });
    await fireUntilGone(api, "small");
    scores.push((await api.snapshot()).score);
  }

  check.expectEq("the first kill scores 100", scores[0], ROCK_SCORE.small);
  check.expectGt("the score rises on the second kill", scores[1], scores[0]);
  check.expectGt("the score rises again on the third kill", scores[2], scores[1]);
  check.expectEq("three Small kills total 300", scores[2], 3 * ROCK_SCORE.small);

  await liveClip(api, 600);
  return check.verdict();
}
