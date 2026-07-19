// Automated validation for movement.no-drill-up.
//
// The ceiling is solid: thrusting up into rock above never removes a tile (the only way up is
// the jetpack through tunnels already carved). We set a rock ceiling, hold thrust, run the real
// physics forward, and confirm the tile above is untouched and no upward cut ever begins.

import { K, newRun, standAt, solid, TOPSOIL_ROW, SPAWN_COL, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("movement.no-drill-up");
  const col = SPAWN_COL;
  const row = TOPSOIL_ROW;

  await newRun(api);
  await standAt(api, col, row);
  await solid(api, col, row - 1); // a rock ceiling directly above
  const pre = await api.call("tileAt", col, row - 1);
  check.expectOk("the ceiling starts as solid rock", pre && pre.kind === "rock");

  await api.call("keyDown", K.thrust);
  await api.step(1.0); // thrust up into the ceiling for a full second
  await api.call("keyUp", K.thrust);

  const above = await api.call("tileAt", col, row - 1);
  const snap = await api.snapshot();
  check.expectEq("the ceiling tile is never removed", above ? above.kind : null, "rock");
  check.expectEq("no cut is ever directed upward", snap.miner.drilling, null);

  await liveClip(api, 600);
  return check.verdict();
}
