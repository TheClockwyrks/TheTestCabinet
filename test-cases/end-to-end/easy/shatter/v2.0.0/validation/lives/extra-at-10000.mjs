// Automated validation for the Lives item `extra-at-10000`: an extra ship is granted at
// each 10,000-point threshold. The score is set just below 10,000, then a real Small rock
// is destroyed (+100) to cross the threshold through the real scoring code, which must add
// a life.

import { newGame, liveClip, fireUntilGone } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("lives.extra-at-10000");

  await newGame(api);
  await api.call("setLives", 3);
  await api.call("setScore", 9990); // one Small kill from the 10,000 threshold
  await api.call("addRock", "small", { x: 400, y: 250, vx: 0, vy: 0 });
  await fireUntilGone(api, "small");
  const snap = await api.snapshot();

  check.expectEq("crossing 10,000 points scores through to 10,090", snap.score, 10090);
  check.expectEq("crossing the 10,000-point threshold grants an extra ship", snap.lives, 4);

  await liveClip(api, 700);
  return check.verdict();
}
