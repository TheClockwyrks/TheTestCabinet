// Automated validation for controls.pause-space: once a wave is live, pressing Space toggles
// the in-place pause.

import { startBuild, spawnControlled, snap, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.pause-space");

  await startBuild(api);
  await spawnControlled(api, "mote"); // a live wave
  await api.step(0.2);
  await api.call("press", "Space");

  const s = await snap(api);
  check.expectOk("pressing Space during a wave paused in place", s.paused === true);
  check.expectEq("...the screen stays on the board (no menu)", s.screen, "playing");

  await api.call("press", "Space"); // resume for the clip
  await liveClip(api);
  return check.verdict();
}
