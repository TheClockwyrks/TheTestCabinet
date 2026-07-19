// Automated validation for hazards.fall-short-safe.
//
// A drop of a tile or two lands under the safe threshold and deals no impact damage. We drop the
// miner a single tile onto a floor and confirm the hull is unchanged on landing.

import { newRun, SPAWN_COL, TOPSOIL_ROW, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("hazards.fall-short-safe");
  const col = SPAWN_COL;
  const row = TOPSOIL_ROW;

  await newRun(api);
  await api.call("teleport", col, row);
  await api.call("setTile", col, row + 1, { kind: "tunnel" }); // one open tile below
  await api.call("setTile", col, row + 2, { kind: "rock" }); // floor a single tile down
  await api.call("teleport", col, row);
  const hull0 = (await api.snapshot()).miner.hull;

  const r = await stepUntil(api, (s) => s.miner.grounded && s.miner.row > row, 1.5, 0.05);
  check.expectOk("the miner landed", r.hit);
  check.expectClose("a short drop does no hull damage", r.snap.miner.hull, hull0, 0.01);

  await liveClip(api, 500);
  return check.verdict();
}
