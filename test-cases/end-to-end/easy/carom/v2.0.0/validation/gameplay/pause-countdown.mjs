// Automated validation for the Gameplay sub-item `pause-during-countdown`.
//
// Pausing is allowed at any time during gameplay, including during the pre-serve
// countdown (not only once the ball is in flight). A match is started from the title
// with injected keys — which opens on the countdown — and a pause key is pressed
// there; the resulting screen is read back. See validation/_helpers.mjs.

import { startWithKeys } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("gameplay.pause-during-countdown");

  // Starting a match opens on the pre-serve countdown.
  await startWithKeys(api, "solo");
  check.expectEq(
    "a started match opens on the pre-serve countdown",
    (await api.snapshot()).screen,
    "countdown",
  );

  // Pressing a pause key during the countdown pauses the game.
  await api.call("press", "Escape");
  check.expectEq(
    "pressing Esc during the countdown pauses the game",
    (await api.snapshot()).screen,
    "paused",
  );

  await api.wait(200);
  await api.screenshot("paused");

  return check.verdict();
}
