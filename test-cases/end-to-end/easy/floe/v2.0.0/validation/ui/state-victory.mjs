// Automated validation for the UI item `state-victory`: the victory screen is
// reachable, and the debug API captures it. Level 8 is cleared through the real
// flow (fill the fifth bay) and the victory screen read back and captured. The
// layout is judged by eye.

import { WATER_TOP } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("ui.state-victory");

  await api.reset();
  await api.call("setLevel", 8);
  await api.call("setBays", [true, true, true, true, false]);
  await api.call("setLane", WATER_TOP, { cols: [35], speed: 0 });
  await api.call("placeCritter", 35, WATER_TOP);
  await api.call("press", "ArrowUp");
  await api.step(0.2);
  check.expectEq("clearing level 8 reaches the victory screen", (await api.snapshot()).screen, "victory");
  await api.wait(150);
  await api.screenshot("victory");

  return check.verdict();
}
