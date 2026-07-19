// Automated validation for the States sub-item `gameover`.
//
// Losing the last life reaches the Game over (reactor breached) state
// (specs/states.md). With one life and no defense, a single real Mote leaks and ends
// the run.

import { newGame, spawn, stepUntil } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.gameover");

  await newGame(api, "containment", "medium");
  await api.call("setLives", 1);
  await spawn(api, "mote", "left");

  const r = await stepUntil(api, (s) => s.screen === "gameover", 30, 0.2);
  check.expectOk("the last-life leak ends the run", r.hit);
  check.expectEq("the screen is Game over", (await api.snapshot()).screen, "gameover");

  await api.wait(120);
  await api.screenshot("gameover");
  return check.verdict();
}
