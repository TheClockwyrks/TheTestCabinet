// State: the shift-failed screen is reachable by running the clock out.

import { startFresh, settle } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.level-failed");
  await startFresh(api, 1);
  await api.call("setClock", 0.5);
  await api.step(1.0);
  await settle(api, 150);
  check.expectEq("failing reaches the shift-failed screen", (await api.snapshot()).screen, "level-failed");
  await api.screenshot("state");
  return check.verdict();
}
