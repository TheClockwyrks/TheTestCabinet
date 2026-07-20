// Automated validation for the Phases sub-item `opening-untimed`.
//
// Before Wave 1 the opening build phase is untimed: no countdown, never auto-starts
// (specs/economy.md, states.md). We start a game and step a long time; it stays in
// the opening phase at wave 0 with no build timer.

import { newGame } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("phases.opening-untimed");

  const start = await newGame(api, "containment", "medium");
  check.expectEq("the game opens in the opening phase", start.phase, "opening");
  check.expectEq("no wave has started (wave 0)", start.wave, 0);
  check.expectEq("the opening phase shows no countdown", start.buildTimer, null);

  await api.step(30); // far longer than any build countdown
  const later = await api.snapshot();
  check.expectEq("it never auto-starts (still the opening phase)", later.phase, "opening");
  check.expectEq("still wave 0", later.wave, 0);
  check.expectEq("still no countdown", later.buildTimer, null);

  await api.wait(80);
  await api.screenshot("opening");
  return check.verdict();
}
