// Automated validation for the Controls item `pause-p`.
//
// Pressing P during play pauses the game. A real run is started, then P is
// injected and the resulting screen read back. See validation/_helpers.mjs.

import { startCrossing } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.pause-p");

  await startCrossing(api);
  await api.call("press", "KeyP");
  check.expectEq("pressing P pauses the game", (await api.snapshot()).screen, "paused");

  // Clip: play briefly, then pause, in real time.
  await startCrossing(api);
  await api.wait(500);
  await api.call("press", "KeyP");
  await api.wait(700);

  return check.verdict();
}
