// Automated validation for the Controls sub-item `pause`.
//
// A pause key (Esc, or P) pauses a live wave. Each binding is pressed through
// injected input during a live wave and the resulting paused screen read back.

import { startClean, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.pause");

  await startClean(api);
  await api.call("press", "Escape");
  check.expectEq("Esc pauses the wave", (await api.snapshot()).screen, "paused");

  await startClean(api);
  await api.call("press", "KeyP");
  check.expectEq("P pauses the wave", (await api.snapshot()).screen, "paused");

  // A live clip: play, then pause.
  await startClean(api, { clear: false });
  await clip(api, 500);
  await api.call("press", "Escape");
  await api.wait(700);
  return check.verdict();
}
