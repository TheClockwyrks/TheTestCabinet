// Automated validation for the States sub-item `victory`.
//
// Clearing the final wave reaches the Victory state (specs/states.md). We jump to the
// final wave with a huge life reserve and start it; the whole wave resolves (its
// units leak past, costing lives from a bottomless reserve) until the wave is clear,
// which the real clear-wave code turns into Victory. Nothing fabricates the state.

import { newGame, stepUntil } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.victory");

  const s0 = await newGame(api, "containment", "medium", 100000);
  await api.call("setLives", 100000000); // survive the whole final wave leaking past
  await api.call("setWave", s0.waveCount); // the final wave
  await api.call("startWave");

  const r = await stepUntil(api, (s) => s.screen === "victory", 220, 0.5);
  check.expectOk("clearing the final wave reaches Victory", r.hit);
  check.expectEq("the screen is Victory", (await api.snapshot()).screen, "victory");

  await api.wait(120);
  await api.screenshot("victory");
  return check.verdict();
}
