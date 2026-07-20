// Automated validation for the UI sub-item `state-gameover`: the game-over screen is
// reachable, and captured for the reviewer.
//
// Lives are posed to one and a real lethal hit taken (an opposite-band bullet on the
// ship); losing the last life ends the game through the real path, landing on the
// game-over screen, which is read back and captured.

import { startClean, shieldBullet, stepUntil } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("ui.state-gameover");

  await startClean(api);
  await api.call("setShipBand", "cyan");
  await api.call("setLives", 1);
  await shieldBullet(api, "magenta"); // opposite the ship's band -> lethal
  const r = await stepUntil(api, (s) => s.screen === "gameOver", 0.5);
  check.expectOk("losing the last life reaches the game-over screen", r.hit);
  await api.wait(120);
  await api.screenshot("gameover");

  return check.verdict();
}
