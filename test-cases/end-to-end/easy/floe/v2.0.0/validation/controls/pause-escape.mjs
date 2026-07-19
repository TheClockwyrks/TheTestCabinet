// Automated validation for the Controls item `pause-escape`.
//
// Pressing Escape during play pauses the game. A real run is started, then Escape
// is injected and the resulting screen read back. See validation/_helpers.mjs.

import { startCrossing } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.pause-escape");

  await startCrossing(api);
  await api.call("press", "Escape");
  check.expectEq("pressing Escape pauses the game", (await api.snapshot()).screen, "paused");

  // Clip: play briefly, then pause, in real time.
  await startCrossing(api);
  await api.wait(500);
  await api.call("press", "Escape");
  await api.wait(700);

  return check.verdict();
}
