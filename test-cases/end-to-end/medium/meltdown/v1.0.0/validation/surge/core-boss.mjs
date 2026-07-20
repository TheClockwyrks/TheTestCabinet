// Automated validation for the Surge sub-item `core-boss`.
//
// The Core boss carries a huge HP pool and, if it leaks, costs five lives
// (specs/surge.md). We spawn a real Core, read its base HP (1600 at wave 1), and let
// it breach an exhaust — lives drop by five.

import { newGame, spawn, unit, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("surge.core-boss");

  await newGame(api, "containment", "medium", 100000);
  await api.call("setLives", 20);
  const id = await spawn(api, "core", "left");
  const c = await unit(api, id);
  check.expectClose("a Core's base HP is 1600", c.maxHp, 1600, 1);

  const r = await stepUntil(api, (s) => s.lives < 20, 45, 0.25);
  check.expectOk("the Core breached", r.hit);
  check.expectEq("a Core leak costs five lives", (await api.snapshot()).lives, 15);

  await api.call("setLives", 20);
  await spawn(api, "core", "left");
  await liveClip(api, 2200);
  return check.verdict();
}
