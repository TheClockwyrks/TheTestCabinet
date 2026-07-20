// Automated validation for core-run.death-destroys.
//
// A death while carrying the Core Sample destroys it regardless of mode. We carry the Sample, cause
// a hull death, and confirm the Sample is gone on the Game Over screen.

import { newRun, standAt, SPAWN_COL, ROCKBED_ROW, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("core-run.death-destroys");

  await newRun(api);
  await standAt(api, SPAWN_COL, ROCKBED_ROW);
  await api.call("spawnCoreSample");
  check.expectEq("the Sample is carried before the death", (await api.snapshot()).satchel.coreSample, true);

  await api.call("setHull", 0);
  const r = await stepUntil(api, (s) => s.screen === "game-over", 3, 0.1);
  check.expectEq("the run ended", r.snap.screen, "game-over");
  check.expectEq("the death was by hull loss, not the timer", r.snap.summary ? r.snap.summary.deathCause : null, "hull-destroyed");
  check.expectEq("the carried Sample is destroyed on death", r.snap.satchel.coreSample, false);

  await liveClip(api, 600);
  return check.verdict();
}
