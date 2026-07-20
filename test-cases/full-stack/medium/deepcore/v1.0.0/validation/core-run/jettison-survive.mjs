// Automated validation for core-run.jettison-survive.
//
// Jettisoning the Sample and fleeing beyond the blast radius survives its ground detonation; the
// Sample is destroyed but the miner lives. We extract, jettison, flee far, run past the timer, and
// confirm the miner is still alive with the Sample gone.

import { newRun, solid, SPAWN_COL, DEEPSTONE_ROW, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("core-run.jettison-survive");
  const col = SPAWN_COL;
  const row = DEEPSTONE_ROW;

  await newRun(api);
  await api.call("teleport", col, row);
  await solid(api, col, row + 1);
  await api.call("teleport", col, row);
  await api.call("spawnCoreSample");
  await api.call("jettison"); // drop it on this tile; timer keeps running
  const dropped = await api.snapshot();
  check.expectOk("the Sample is a ground item after jettison", !!dropped.coreGround);
  check.expectEq("it is no longer carried", dropped.satchel.coreSample, false);

  // Flee well beyond the blast radius (~3 tiles).
  await api.call("teleport", col + 10, row);
  await solid(api, col + 10, row + 1);
  await api.call("teleport", col + 10, row);

  await api.step(92); // past the timer; the ground detonation fires far away
  const snap = await api.snapshot();
  check.expectEq("the miner survives the distant detonation", snap.screen, "in-mine");
  check.expectEq("the Sample is destroyed", snap.coreGround, null);
  check.expectEq("the timer has ended", snap.coreTimer, null);

  await liveClip(api, 600);
  return check.verdict();
}
