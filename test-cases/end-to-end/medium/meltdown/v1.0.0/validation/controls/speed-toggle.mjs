// Automated validation for the Controls sub-item `speed-toggle`.
//
// F toggles the game-speed control between 1x and 2x (specs/controls.md). We read the
// speed, press F, and read it toggle.

import { newGame, press } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.speed-toggle");

  await newGame(api, "containment", "medium");
  check.expectEq("the game starts at 1x", (await api.snapshot()).speed, 1);
  await press(api, "KeyF");
  check.expectEq("F toggles to 2x", (await api.snapshot()).speed, 2);

  await api.wait(80);
  await api.screenshot("speed");
  return check.verdict();
}
