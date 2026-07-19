// Automated validation for the Economy sub-item `defeat`.
//
// Reaching zero integrity loses the game — the containment-failed (defeat) screen
// appears, even mid-round. The check sets integrity to 1, poses a unit near the
// collector whose leak cost exceeds it, and steps until the defeat screen resolves
// through the real containment check.

import { startRun, pathGeom, spawnAt, stepUntil, MAP } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("economy.defeat");

  const snap = await startRun(api, MAP.single, { integrity: 1 });
  const g = pathGeom(snap.paths[0]);
  await spawnAt(api, { type: "atom", electrons: 3, pathId: 0, s: g.length - 20 });

  const r = await stepUntil(api, (s) => s.screen === "defeat", 4, 0.05);
  check.expectOk("reaching zero integrity ends the game", r.hit);
  check.expectEq("the game is lost (defeat screen)", r.snap.screen, "defeat");

  await api.wait(200);
  await api.screenshot("defeat");
  return check.verdict();
}
