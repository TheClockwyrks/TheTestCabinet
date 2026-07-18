// Automated validation for the UI sub-item `state-matchover`: the match-over screen
// is reachable, and the debug API captures it so a reviewer sees the actual screen.
//
// A real match is driven to its end (10-0, then a real point across the goal to
// 11-0); the screen is read back and a screenshot captured as the reviewer's proof.
// Whether the screen (winner, final score, play again / menu) reads well is judged by
// eye from the capture. See validation/_helpers.mjs.

import { driveToMatchOver } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("ui.state-matchover");

  const end = await driveToMatchOver(api, "versus");
  check.expectEq(
    "winning a match opens the match-over screen",
    end.screen,
    "matchover",
  );
  await api.wait(200);
  await api.screenshot("matchover");

  return check.verdict();
}
