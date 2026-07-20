// Automated validation for the Boss sub-item `milestone-rounds`.
//
// The milestone rounds (10, 20, 30, 40) fold Macromass bosses into the wave, while ordinary
// rounds do not. The check starts each milestone round plus an ordinary one and steps
// through the wave: a macromass appears in every milestone round and never in the ordinary
// one. The boss group is released last (specs/matter.md), so each round is stepped through
// its whole span on the manual clock.

import { startRun, stepUntil, liveClip, MAP } from "../_helpers.mjs";

const BOSS_ROUNDS = [10, 20, 30, 40];
const ORDINARY_ROUND = 9;
const MAX_WAVE_SECONDS = 120; // generous: game time on the manual clock, not wall clock

async function bossAppears(api, round) {
  await startRun(api, MAP.single, { round, integrity: 1e9 });
  await api.call("startRound");
  const r = await stepUntil(api, (s) => s.matter.some((u) => u.type === "macromass"), MAX_WAVE_SECONDS, 0.5);
  return r.hit;
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("boss.milestone-rounds");

  for (const round of BOSS_ROUNDS) {
    check.expectOk(`round ${round} folds in a boss`, await bossAppears(api, round));
  }
  check.expectOk(
    `an ordinary round (${ORDINARY_ROUND}) has no boss`,
    (await bossAppears(api, ORDINARY_ROUND)) === false,
  );

  await liveClip(api, 800);
  return check.verdict();
}
