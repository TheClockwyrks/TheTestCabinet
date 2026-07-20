// Automated validation for the Economy sub-item `early-send`.
//
// Sending a wave early during a timed build phase pays a bonus equal to the seconds
// left on the countdown (specs/economy.md). We enter a timed between-wave build phase,
// set a known 7-second countdown and 100 money, and send early — the money rises by
// exactly 7.

import { newGame } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("economy.early-send");

  await newGame(api, "containment", "medium", 100000);
  await api.call("setWave", 2); // a timed between-wave build phase
  await api.call("setMoney", 100);
  await api.call("setBuildTimer", 7);
  await api.call("startWave"); // send early

  check.expectEq("sending with 7s left pays a bonus of 7", (await api.snapshot()).money, 107);

  await api.wait(80);
  await api.screenshot("early");
  return check.verdict();
}
