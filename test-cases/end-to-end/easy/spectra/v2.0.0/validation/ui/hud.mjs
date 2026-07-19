// Automated validation for the UI sub-item `hud`: the in-wave HUD shows the score,
// stage, lives, resonance meter, and polarity indicator together.
//
// A live wave is entered and the run state posed to a full HUD (a non-zero score,
// partial resonance, several lives); the in-wave screen is confirmed and captured
// so a reviewer can read the HUD. How it reads is judged by eye from the capture.

import { startClean } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("ui.hud");

  await startClean(api, { clear: false });
  await api.step(1.0); // let drones fly in so the field is populated
  await api.call("setScore", 12340);
  await api.call("setResonance", 60);
  await api.call("setLives", 3);
  check.expectEq("the HUD is captured during a live wave", (await api.snapshot()).screen, "inWave");
  await api.wait(120);
  await api.screenshot("hud");

  return check.verdict();
}
