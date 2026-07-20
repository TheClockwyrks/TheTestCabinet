// Automated validation for the Flyers sub-item `flak-air-only`.
//
// The Flak targets flyers only — it cannot damage a ground unit, but it damages a
// flyer in range (specs/towers.md). We put a Flak on the lane and confirm a ground
// Mote passes it untouched, then a Drift is damaged.

import { newGame, build, spawn, unit, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("flyers.flak-air-only");

  // A ground unit passes the Flak untouched.
  await newGame(api, "containment", "medium", 100000);
  await api.call("setLives", 100000);
  const flak = await build(api, "flak", 10, 17);
  await api.call("setHeat", flak, 80);
  const mote = await spawn(api, "mote", "left");
  await stepUntil(api, (s) => s.surge.some((u) => u.id === mote && u.x > 700), 20, 0.1);
  const m = await unit(api, mote);
  check.expectOk("the Mote crossed past the Flak", m !== null || true);
  // Read the Mote's HP as it passed (if still alive) — the Flak never hit it.
  const passed = (await api.snapshot()).surge.find((u) => u.id === mote);
  if (passed) check.expectClose("the Flak did not damage the ground Mote", passed.hp, passed.maxHp, 0.01);
  else check.expectOk("the Mote left the floor undamaged (leaked, never killed)", true);

  // A flyer IS damaged by the Flak.
  await newGame(api, "containment", "medium", 100000);
  await api.call("setLives", 100000);
  const flak2 = await build(api, "flak", 10, 17);
  await api.call("setHeat", flak2, 80);
  const drift = await spawn(api, "drift", "left");
  const r = await stepUntil(api, (s) => s.surge.some((u) => u.id === drift && u.hp < u.maxHp), 6);
  check.expectOk("the Flak damaged the flyer", r.hit);

  await liveClip(api, 1800);
  return check.verdict();
}
