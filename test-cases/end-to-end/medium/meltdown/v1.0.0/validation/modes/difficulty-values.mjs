// Automated validation for the Modes sub-item `difficulty-values`.
//
// Containment Easy, Medium, and Hard change the starting money and the number of
// waves (specs/modes.md — Easy 350/15, Medium 250/20, Hard 200/26). We start each and
// read its money and wave count.

import { newGame } from "../_helpers.mjs";

const EXPECTED = {
  easy: { money: 350, waves: 15 },
  medium: { money: 250, waves: 20 },
  hard: { money: 200, waves: 26 },
};

export default async function drive(api, ttc) {
  const check = ttc.checkOne("modes.difficulty-values");

  for (const [diff, want] of Object.entries(EXPECTED)) {
    const s = await newGame(api, "containment", diff);
    check.expectEq(`${diff} starting money`, s.money, want.money);
    check.expectEq(`${diff} wave count`, s.waveCount, want.waves);
  }

  await api.wait(80);
  await api.screenshot("difficulty");
  return check.verdict();
}
