// Automated validation for fuel.out-death.
//
// Fuel reaching 0 while underground strands the miner and ends the run at Game Over with an
// out-of-fuel cause. We set fuel to 0 on a grounded underground miner and step the real sim until
// the death resolves.

import { newRun, standAt, ROCKBED_ROW, SPAWN_COL, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("fuel.out-death");
  const col = SPAWN_COL;
  const row = ROCKBED_ROW;

  await newRun(api);
  await standAt(api, col, row);
  await api.call("setFuel", 0);
  const r = await stepUntil(api, (s) => s.screen === "game-over", 3, 0.1);
  check.expectEq("running dry underground ends the run", r.snap.screen, "game-over");
  check.expectEq("the death cause is out of fuel", r.snap.summary ? r.snap.summary.deathCause : null, "fuel-out");

  await liveClip(api, 700);
  return check.verdict();
}
