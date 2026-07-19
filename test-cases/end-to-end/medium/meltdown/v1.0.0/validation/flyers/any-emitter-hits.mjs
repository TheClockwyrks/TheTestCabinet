// Automated validation for the Flyers sub-item `any-emitter-hits`.
//
// Any emitter can damage a flyer in range — the Flak is the dedicated air specialist,
// not the only counter (specs/towers.md). We place a plain Arc on the flight line,
// spawn a real Drift, and confirm the Arc damages it.

import { newGame, build, spawn, unit, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("flyers.any-emitter-hits");

  await newGame(api, "containment", "medium", 100000);
  await api.call("setLives", 100000);
  const arc = await build(api, "arc", 10, 17);
  await api.call("setHeat", arc, 80); // fire at real damage
  const id = await spawn(api, "drift", "left");

  const r = await stepUntil(api, (s) => s.surge.some((u) => u.id === id && u.hp < u.maxHp), 6);
  check.expectOk("a plain Arc damaged the flyer in range", r.hit);

  await api.call("setLives", 100000);
  await spawn(api, "drift", "left");
  await liveClip(api, 2000);
  return check.verdict();
}
