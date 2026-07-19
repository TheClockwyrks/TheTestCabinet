// Automated validation for the Phases sub-item `opening-start`.
//
// Pressing Start in the opening phase begins Wave 1 (specs/economy.md, states.md).
// We send from the opening phase and confirm the match enters the wave phase at
// wave 1.

import { newGame, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("phases.opening-start");

  await newGame(api, "containment", "medium");
  await api.call("setLives", 100000);
  await api.call("startWave");
  const s = await api.snapshot();

  check.expectEq("Start begins the wave phase", s.phase, "wave");
  check.expectEq("it begins Wave 1", s.wave, 1);

  await liveClip(api, 1600);
  return check.verdict();
}
