// Automated validation for the Modes sub-item `replay`.
//
// RESTART and PLAY AGAIN replay the same mode and difficulty (specs/modes.md). We
// drive a Containment/Medium run to Game over, then choose PLAY AGAIN and confirm the
// fresh run is the same mode and difficulty.

import { newGame, spawn, stepUntil, press, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("modes.replay");

  await newGame(api, "containment", "medium");
  await api.call("setLives", 1);
  await spawn(api, "mote", "left");
  const over = await stepUntil(api, (s) => s.screen === "gameover", 30, 0.2);
  check.expectOk("the run ended in Game over", over.hit);

  await press(api, "Enter"); // PLAY AGAIN
  const s = await api.snapshot();
  check.expectEq("PLAY AGAIN starts a fresh playing run", s.screen, "playing");
  check.expectEq("it replays the same mode", s.mode, "containment");
  check.expectEq("it replays the same difficulty", s.difficulty, "medium");

  await liveClip(api, 1600);
  return check.verdict();
}
