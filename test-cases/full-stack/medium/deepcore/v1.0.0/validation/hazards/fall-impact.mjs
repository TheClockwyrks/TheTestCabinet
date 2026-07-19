// Automated validation for hazards.fall-impact.
//
// A long free-fall lands hard enough to damage the hull, scaled to the excess landing speed. We
// drop the miner down a tall open shaft onto a floor and read the hull lost on the slam.

import { newRun, openColumn, solid, SPAWN_COL, TOPSOIL_ROW, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("hazards.fall-impact");
  const col = SPAWN_COL;
  const row = TOPSOIL_ROW;

  await newRun(api);
  await api.call("teleport", col, row);
  await openColumn(api, col, row + 1, row + 12); // a long open plunge
  await solid(api, col, row + 13);
  await api.call("grantGear", { hull: 5 }); // survive the slam; hull 450, refilled
  const hull0 = (await api.snapshot()).miner.hull;

  const r = await stepUntil(api, (s) => s.miner.grounded && s.miner.row > row + 5, 3, 0.05);
  check.expectOk("the miner landed after the plunge", r.hit);
  check.expectGt("a long plunge deals impact hull damage", hull0 - r.snap.miner.hull, 10);

  await liveClip(api, 500);
  return check.verdict();
}
