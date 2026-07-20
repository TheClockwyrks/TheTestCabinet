// Automated validation for the Surge sub-item `hulk-leak`.
//
// A Hulk leak costs two lives, more than a light unit (specs/surge.md). We let a real
// Hulk walk out an exhaust and confirm lives drop by exactly two.

import { newGame, spawn, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("surge.hulk-leak");

  await newGame(api, "containment", "medium", 100000);
  await api.call("setLives", 10);
  await spawn(api, "hulk", "left");

  const r = await stepUntil(api, (s) => s.lives < 10, 45, 0.25);
  check.expectOk("the Hulk leaked", r.hit);
  check.expectEq("a Hulk leak costs two lives", (await api.snapshot()).lives, 8);

  await api.call("setLives", 10);
  await spawn(api, "hulk", "left");
  await liveClip(api, 2200);
  return check.verdict();
}
