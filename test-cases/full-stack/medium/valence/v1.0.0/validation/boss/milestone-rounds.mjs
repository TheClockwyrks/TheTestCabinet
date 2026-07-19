// Automated validation for the Boss sub-item `milestone-rounds`.
//
// The milestone rounds (10 and 20) fold a Macromass boss into the wave, while ordinary
// rounds do not. The check starts each of rounds 10, 20, and 9 and steps through the
// wave: a macromass appears in the two milestone rounds and never in the ordinary one.

import { startRun, stepUntil, liveClip, MAP } from "../_helpers.mjs";

async function bossAppears(api, round, maxSeconds) {
  await startRun(api, MAP.single, { round, integrity: 1e9 });
  await api.call("startRound");
  const r = await stepUntil(api, (s) => s.matter.some((u) => u.type === "macromass"), maxSeconds, 0.5);
  return r.hit;
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("boss.milestone-rounds");

  check.expectOk("round 10 folds in a boss", await bossAppears(api, 10, 16));
  check.expectOk("round 20 folds in a boss", await bossAppears(api, 20, 22));
  check.expectOk("an ordinary round (9) has no boss", (await bossAppears(api, 9, 16)) === false);

  await liveClip(api, 800);
  return check.verdict();
}
