// Automated validation for the Pause sub-item `esc-over-inplace`.
//
// `Esc` opens the pause menu even when the game is already paused in place — the two
// pauses are distinct. The check pauses in place with Space (screen stays the live board)
// and then presses Escape, which opens the pause-menu screen over it.

import { startRun, liveClip, MAP } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("pause.esc-over-inplace");

  await startRun(api, MAP.single, { round: 1 });
  await api.call("startRound");
  await api.call("press", "Space"); // in-place pause
  const inplace = await api.snapshot();
  check.expectEq("paused in place first", inplace.paused, true);
  check.expectEq("still the live board (no menu)", inplace.screen, "playing");

  await api.call("press", "Escape"); // opens the menu even though already paused
  check.expectEq("Esc opens the pause menu over the in-place pause", (await api.snapshot()).screen, "paused");

  await api.wait(150);
  await liveClip(api, 800);
  return check.verdict();
}
