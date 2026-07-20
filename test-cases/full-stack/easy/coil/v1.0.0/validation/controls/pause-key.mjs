// Automated validation for the Controls sub-item `pause-key`.
//
// Both Escape and P pause a live round. A round is started from the title with injected
// keys; Escape is pressed (pauses), pressed again (resumes), then P is pressed (pauses).
// Each key flows through the real key handling and the resulting screen is read back.

import { startWithKeys, hLane, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.pause-key");

  await startWithKeys(api);

  await api.call("press", "Escape");
  check.expectEq("Escape pauses a live round", (await api.snapshot()).screen, "paused");

  await api.call("press", "Escape"); // resume
  check.expectEq("Escape resumes from pause", (await api.snapshot()).screen, "playing");

  await api.call("press", "KeyP");
  check.expectEq("P pauses a live round", (await api.snapshot()).screen, "paused");

  await liveClip(api, { snake: hLane(6, 8, 4), pellet: { col: 16, row: 8 } });
  return check.verdict();
}
