// Automated validation for the Info sub-item `counts`.
//
// A placed tower shows its lifetime kills and total damage dealt — runtime tallies
// that grow as it fights (specs/reactor.md). We drive a real Arc into a stream of
// Motes and read its kill and damage tallies climb.

import { newGame, build, spawn, tower, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("info.counts");

  await newGame(api, "containment", "medium", 100000);
  await api.call("setLives", 100000);
  const id = await build(api, "arc", 3, 20);
  await api.call("setHeat", id, 80); // real damage so it kills
  for (let i = 0; i < 5; i += 1) await spawn(api, "mote", "left");

  const r = await stepUntil(api, (s) => s.towers.some((t) => t.id === id && t.kills > 0), 12, 0.1);
  const t = await tower(api, id);
  check.expectOk("the tower recorded a kill", r.hit);
  check.expectGt("its lifetime kill count is above zero", t.kills, 0);
  check.expectGt("its total damage dealt is above zero", t.damageDealt, 0);

  await api.call("setLives", 100000);
  for (let i = 0; i < 5; i += 1) await spawn(api, "mote", "left");
  await liveClip(api, 2000);
  return check.verdict();
}
