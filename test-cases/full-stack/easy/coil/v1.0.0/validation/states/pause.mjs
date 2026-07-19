// Automated validation for the Game States sub-item `pause`.
//
// The pause screen is reachable during a live round. A round is started, a pause key
// is pressed, and the resulting screen is read back and captured so a reviewer sees
// the actual pause menu (resume / restart / quit). How it reads is judged by eye.

import { hLane, beginRound } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.pause");

  await beginRound(api);
  await api.call("setSnake", hLane(12, 8, 3), "right"); // a settled mid-board pose
  await api.call("press", "Escape"); // pause
  await api.wait(120);
  check.expectEq("pressing Escape during a round pauses it", (await api.snapshot()).screen, "paused");
  await api.screenshot("pause");

  return check.verdict();
}
