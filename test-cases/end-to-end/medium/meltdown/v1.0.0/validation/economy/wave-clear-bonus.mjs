// Automated validation for the Economy sub-item `wave-clear-bonus`.
//
// Clearing a wave pays a wave-clear bonus that grows with the wave number
// (specs/economy.md — wave 1 pays 25). We run wave 1 to a clear in Deep Pockets
// (which pays no interest, so the bonus is isolated) from zero money and with no
// towers, so the whole wave leaks past and only the bonus lands.

import { newGame, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("economy.wave-clear-bonus");

  await newGame(api, "deeppockets");
  await api.call("setLives", 1000000);
  await api.call("setMoney", 0);
  await api.call("startWave"); // begin wave 1

  const r = await stepUntil(api, (s) => s.money >= 25, 40, 0.2);
  check.expectOk("wave 1 cleared and paid out", r.hit);
  check.expectEq("clearing wave 1 pays exactly the wave bonus (25), no interest", (await api.snapshot()).money, 25);

  await liveClip(api, 1500);
  return check.verdict();
}
