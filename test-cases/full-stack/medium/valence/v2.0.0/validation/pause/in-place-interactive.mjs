// Automated validation for the Pause sub-item `in-place-interactive`.
//
// While paused in place the board is still interactive — a tower can still be placed on
// the still board. The check starts a live round, pauses in place, and places a tower,
// confirming it succeeds while the paused flag stays set.

import { startRun, pathGeom, placeCovering, liveClip, MAP } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("pause.in-place-interactive");

  const snap = await startRun(api, MAP.single, { round: 1, integrity: 100000, energy: 100000 });
  await api.call("startRound");
  await api.call("press", "Space"); // pause in place
  const paused = await api.snapshot();
  check.expectEq("the board is paused in place", paused.paused, true);
  const before = paused.towers.length;

  const g = pathGeom(snap.paths[0]);
  await placeCovering(api, "emitter", g, g.length * 0.35);
  const after = await api.snapshot();
  check.expectEq("still paused in place after placing", after.paused, true);
  check.expectEq("a tower can still be placed while paused in place", after.towers.length, before + 1);

  await liveClip(api, 1000);
  return check.verdict();
}
