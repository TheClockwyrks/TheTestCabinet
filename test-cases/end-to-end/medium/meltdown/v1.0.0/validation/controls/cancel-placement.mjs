// Automated validation for the Controls sub-item `cancel-placement`.
//
// Esc cancels an armed placement before it falls back to pausing (specs/controls.md).
// We arm a tower, press Esc, and confirm the held placement is cleared (and the match
// is not paused).

import { newGame, press, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.cancel-placement");

  await newGame(api, "containment", "medium", 100000);
  await press(api, "Digit1"); // arm the Arc
  check.expectEq("a tower is held", (await api.snapshot()).build.type, "arc");
  await press(api, "Escape");
  const s = await api.snapshot();
  check.expectEq("Esc clears the held placement", s.build, null);
  check.expectEq("Esc did not pause (it cancelled the placement first)", s.screen, "playing");

  await liveClip(api, 1400);
  return check.verdict();
}
