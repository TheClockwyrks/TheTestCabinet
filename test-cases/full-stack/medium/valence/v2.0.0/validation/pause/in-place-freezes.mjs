// Automated validation for the Pause sub-item `in-place-freezes`.
//
// During a live round `Space` pauses IN PLACE — the paused flag is set, the screen stays
// the live board (no menu), and matter, the economy, and any countdown freeze. The check
// starts a live round, presses Space, and confirms nothing advances while paused, then
// resumes and confirms matter moves again.

import { startRun, pathGeom, spawnAt, unitById, liveClip, MAP } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("pause.in-place-freezes");

  const snap = await startRun(api, MAP.single, { round: 1, integrity: 100000, energy: 100000 });
  await api.call("startRound");
  const g = pathGeom(snap.paths[0]);
  const id = await spawnAt(api, { type: "atom", electrons: 4, pathId: 0, s: g.length * 0.3 });

  await api.call("press", "Space");
  const paused = await api.snapshot();
  check.expectEq("Space sets the in-place paused flag", paused.paused, true);
  check.expectEq("the screen stays the live board (no menu)", paused.screen, "playing");

  const p0 = unitById(paused, id).progress;
  const e0 = paused.energy;
  await api.step(1.5);
  const frozen = await api.snapshot();
  check.expectEq("matter is frozen while paused in place", unitById(frozen, id).progress, p0);
  check.expectEq("the economy is frozen while paused in place", frozen.energy, e0);

  // Resume: matter advances again.
  await api.call("press", "Space");
  await api.step(0.5);
  check.expectGt("resuming lets matter advance again", unitById(await api.snapshot(), id).progress, p0);

  await liveClip(api, 1200);
  return check.verdict();
}
