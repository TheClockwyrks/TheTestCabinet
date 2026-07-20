// Automated validation for the UI item `state-gameover`: the game-over screen is reachable
// and correct, captured for review. A real game is driven to its end (last ship lost to a
// real collision); the game-over state is read back — showing the final score and the wave
// reached — and captured.

import { newGame, poseShip, stepUntil } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("ui.state-gameover");

  await newGame(api);
  await api.call("setScore", 1234);
  await api.call("setLives", 1);
  await api.call("setInvuln", 0);
  await poseShip(api, { x: 300, y: 300, vx: 0, vy: 0, angle: 0 });
  await api.call("addRock", "small", { x: 300, y: 300, vx: 0, vy: 0 });

  const { snap } = await stepUntil(api, (s) => s.screen !== "playing", 1);

  check.expectEq("losing the last ship reaches the game-over screen", snap.screen, "gameover");
  check.expectEq("the game-over screen carries the final score", snap.score, 1234);
  check.expectGt("the game-over screen carries the wave reached", snap.wave, 0);

  await api.wait(160);
  await api.screenshot("gameover");
  return check.verdict();
}
