// Automated validation for the Pause sub-item `menu-esc`.
//
// `Esc` opens the pause menu (Resume / Restart / Quit), which also freezes the game and
// covers it with the menu. The check starts a live round, presses Escape, and confirms
// the game is on the paused-menu screen, then captures it.

import { startRun, MAP } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("pause.menu-esc");

  await startRun(api, MAP.single, { round: 1 });
  await api.call("startRound");
  await api.call("press", "Escape");

  check.expectEq("Esc opens the pause menu", (await api.snapshot()).screen, "paused");

  await api.wait(150);
  await api.screenshot("menu");
  return check.verdict();
}
