// Automated validation for the Lives item `game-over-at-zero`: losing the last ship ends
// the game. One life is left and a rock is placed on the ship with no invulnerability; the
// real collision ends the game, and the game-over screen is captured showing the final
// score.

import { newGame, poseShip, stepUntil } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("lives.game-over-at-zero");

  await newGame(api);
  await api.call("setScore", 500);
  await api.call("setLives", 1); // the last ship
  await api.call("setInvuln", 0);
  await poseShip(api, { x: 300, y: 300, vx: 0, vy: 0, angle: 0 });
  await api.call("addRock", "small", { x: 300, y: 300, vx: 0, vy: 0 });

  const { snap } = await stepUntil(api, (s) => s.screen !== "playing", 1);

  check.expectEq("losing the last ship ends the game", snap.screen, "gameover");
  check.expectEq("there are no ships left", snap.lives, 0);
  check.expectEq("the final score is carried onto the game-over screen", snap.score, 500);

  await api.wait(160);
  await api.screenshot("gameover");
  return check.verdict();
}
