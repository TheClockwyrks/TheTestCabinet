// Automated validation for states.inplace-pause: the in-place pause freezes all ticks (sim
// time stops advancing) while the screen stays on the board with no menu, then resumes.

import { startBuild, spawnControlled, snap, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.inplace-pause");

  await startBuild(api);
  await spawnControlled(api, "mote"); // a live wave (units on the floor)
  await api.step(0.3);
  const t0 = (await snap(api)).simTime;

  await api.call("press", "Space"); // in-place pause
  const sp = await snap(api);
  check.expectOk("the in-place pause is set", sp.paused === true);
  check.expectEq("...the screen stays on the board (no menu)", sp.screen, "playing");

  await api.step(1.0); // stepping does nothing while paused
  check.expectClose("ticks are frozen while paused (sim time does not advance)", (await snap(api)).simTime, t0, 1e-6);

  await api.call("press", "Space"); // resume, then show motion
  await liveClip(api);
  return check.verdict();
}
