// Automated validation for the Surge sub-item `leak-costs-life`.
//
// A unit that reaches an exhaust leaks and costs the player a life (specs/surge.md —
// a Mote costs 1). We spawn a real Mote with no defense and let it walk out an
// exhaust; lives drop by exactly one.

import { newGame, spawn, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("surge.leak-costs-life");

  await newGame(api, "containment", "medium", 100000);
  await api.call("setLives", 10);
  await spawn(api, "mote", "left");

  const r = await stepUntil(api, (s) => s.lives < 10, 30, 0.2);
  check.expectOk("the Mote leaked", r.hit);
  check.expectEq("a Mote leak costs one life", (await api.snapshot()).lives, 9);

  await api.call("setLives", 10);
  await spawn(api, "mote", "left");
  await liveClip(api, 2000);
  return check.verdict();
}
