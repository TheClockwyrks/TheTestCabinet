// Automated validation for the Sink sub-item `inert`.
//
// The Sink has no heat of its own and deals no damage — it never fires at the surge
// (specs/towers.md). A Sink is placed beside the lane with a real Core in range and
// the sim is stepped; the Sink reports heat 0, damage 0, and is never firing.

import { newGame, build, spawn, tower } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("sink.inert");

  await newGame(api, "containment", "medium", 100000);
  await api.call("setLives", 100000);
  const id = await build(api, "sink", 3, 20);
  await spawn(api, "core", "left");
  await api.step(1);

  const t = await tower(api, id);
  check.expectClose("a Sink has no heat", t.heat, 0, 0.01);
  check.expectClose("a Sink deals no damage", t.damage, 0, 0.01);
  check.expectEq("a Sink never fires", t.firing, false);

  await api.wait(80);
  await api.screenshot("inert");
  return check.verdict();
}
