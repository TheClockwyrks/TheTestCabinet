// Automated validation for states.dmgboard: the DMG BOARD overlay opens a live tower ranking.
// This confirms the overlay is reachable and captures it; how the ranking reads is judged by
// eye from the capture.

import { startBuild, snap } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.dmgboard");

  await startBuild(api);
  await api.call("press", "KeyL"); // toggle the damage leaderboard
  check.expectEq("the damage leaderboard overlay is open", (await snap(api)).overlays.dmgBoard, true);

  await api.screenshot("board");
  return check.verdict();
}
