// Automated validation for the Presentation sub-item `state-won`: the won / victory
// screen is reachable, and the debug API captures it. A real win fires the cascade;
// the sim is stepped a little so the table shows the accumulating painted trail, then
// the won screen is read back and captured. Whether it reads well is judged by eye.

import { winBoard } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("ui.state-won");

  await winBoard(api, 6);
  await api.step(3); // paint some of the cascade trail
  const s = await api.snapshot();
  check.expectEq("the won / victory screen is reachable", s.screen, "won");
  await api.wait(120);
  await api.screenshot("won");

  return check.verdict();
}
