// Automated validation for the Economy sub-item `bounty`.
//
// Killing a unit pays its kill bounty (specs/economy.md — a Mote pays 3). From zero
// money we kill a single real Mote with an Arc and confirm exactly its bounty lands.

import { newGame, build, spawn, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("economy.bounty");

  await newGame(api, "containment", "medium", 100000);
  await api.call("setLives", 100000);
  const id = await build(api, "arc", 3, 20);
  await api.call("setHeat", id, 80);
  await api.call("setMoney", 0);
  await spawn(api, "mote", "left");

  const r = await stepUntil(api, (s) => s.money > 0, 6);
  check.expectOk("killing the Mote paid out", r.hit);
  check.expectEq("a Mote kill pays exactly its bounty (3)", (await api.snapshot()).money, 3);

  await api.call("setMoney", 0);
  await api.call("setLives", 100000);
  for (let i = 0; i < 4; i += 1) await spawn(api, "mote", "left");
  await liveClip(api, 2000);
  return check.verdict();
}
