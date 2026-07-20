// Automated validation for the Modes sub-item `deep-pockets`.
//
// Deep Pockets starts flush with 10,000 funds and pays no interest between waves
// (specs/modes.md). We read the opening balance, then clear wave 1 from 500 money
// with no towers — only the wave bonus (25) lands, with no interest (525 total).

import { newGame, stepUntil } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("modes.deep-pockets");

  const s = await newGame(api, "deeppockets");
  check.expectEq("Deep Pockets opens with 10,000 funds", s.money, 10000);

  await api.call("setLives", 1000000);
  await api.call("setMoney", 500);
  await api.call("startWave");
  const r = await stepUntil(api, (t) => t.wave >= 2, 40, 0.2);
  check.expectOk("wave 1 cleared into the next build phase", r.hit);
  check.expectEq("no interest is paid — only the wave bonus (525 total)", (await api.snapshot()).money, 525);

  await api.wait(80);
  await api.screenshot("deep");
  return check.verdict();
}
