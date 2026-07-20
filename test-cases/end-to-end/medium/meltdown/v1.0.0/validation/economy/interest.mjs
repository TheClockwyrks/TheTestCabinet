// Automated validation for the Economy sub-item `interest`.
//
// Between waves the player earns interest on their savings, capped, in the modes that
// grant it (specs/economy.md — 8% up to a cap of 40). In Containment from 500 money
// with no towers, clearing wave 1 pays the wave bonus (25) plus the capped interest
// (40) — a total of 565.

import { newGame, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("economy.interest");

  await newGame(api, "containment", "medium");
  await api.call("setLives", 1000000);
  await api.call("setMoney", 500);
  await api.call("startWave");

  const r = await stepUntil(api, (s) => s.money > 500 && s.wave >= 2, 40, 0.2);
  check.expectOk("wave 1 cleared into the next build phase", r.hit);
  // 500 + wave-1 bonus (25) + capped interest (40) = 565.
  check.expectEq("interest (40) is paid on top of the bonus", (await api.snapshot()).money, 565);

  await liveClip(api, 1500);
  return check.verdict();
}
