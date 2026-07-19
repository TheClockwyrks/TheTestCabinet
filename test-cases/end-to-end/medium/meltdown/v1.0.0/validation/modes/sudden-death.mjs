// Automated validation for the Modes sub-item `sudden-death`.
//
// Sudden Death gives one life, so a single leak ends the game (specs/modes.md). We
// start it, confirm the one life, and let a single real Mote leak.

import { newGame, spawn, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("modes.sudden-death");

  const s = await newGame(api, "suddendeath");
  check.expectEq("Sudden Death starts with one life", s.lives, 1);

  await spawn(api, "mote", "left");
  const r = await stepUntil(api, (t) => t.screen === "gameover", 30, 0.2);
  check.expectOk("a single leak ends the game", r.hit);

  await newGame(api, "suddendeath");
  await spawn(api, "mote", "left");
  await liveClip(api, 2000);
  return check.verdict();
}
