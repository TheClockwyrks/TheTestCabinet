// Automated validation for the Rime sub-item `cold-slows-most`.
//
// A cold Rime cuts a unit's speed by its full cold-slow ceiling (specs/heat.md,
// towers.md — level-I ceiling 0.55). A cold Rime is placed by the lane with a real
// Mote walking through its range; the real firing/slow systems apply the slow, and
// we read the Mote's speed drop back.

import { newGame, build, spawn, unit, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("rime.cold-slows-most");

  await newGame(api, "containment", "medium", 100000);
  await api.call("setLives", 100000);
  const rime = await build(api, "rime", 3, 18);
  await api.call("setHeat", rime, 0);
  const moteId = await spawn(api, "mote", "left");

  const r = await stepUntil(api, (s) => s.surge.some((u) => u.id === moteId && u.slowed), 3);
  const m = await unit(api, moteId);

  check.expectOk("the cold Rime slowed the Mote", r.hit);
  // A Mote's base speed is 60; a 0.55 slow leaves ~27 px/s.
  check.expectLt("the slowed speed is well below the Mote's base speed", m.speed, 60 * 0.5);
  // The applied slow read back off the unit — the fraction its speed was cut by. A
  // Rime slows hardest on the first, cold shot (it self-heats as it fires), so the
  // fraction the surge actually takes is its full cold ceiling.
  check.expectClose(
    "a cold Rime's slow fraction is its full ceiling (~0.55)",
    1 - m.speed / m.baseSpeed,
    0.55,
    0.02,
  );

  await newGame(api, "containment", "medium", 100000);
  await api.call("setLives", 100000);
  const r2 = await build(api, "rime", 3, 18);
  await api.call("setHeat", r2, 0);
  await spawn(api, "mote", "left");
  await spawn(api, "mote", "left");
  await liveClip(api, 2000);
  return check.verdict();
}
