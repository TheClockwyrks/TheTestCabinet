// Automated validation for the Controls sub-item `send-wave`.
//
// Space starts / sends the next wave (specs/controls.md). From the opening phase,
// pressing Space begins Wave 1.

import { newGame, press, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.send-wave");

  await newGame(api, "containment", "medium");
  await api.call("setLives", 100000);
  await press(api, "Space");
  const s = await api.snapshot();
  check.expectEq("Space starts the wave phase", s.phase, "wave");
  check.expectEq("it begins Wave 1", s.wave, 1);

  await liveClip(api, 1600);
  return check.verdict();
}
