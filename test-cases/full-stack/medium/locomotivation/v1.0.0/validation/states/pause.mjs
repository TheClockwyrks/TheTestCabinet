// State: the pause screen is reachable from a live shift (Esc).

import { startFresh, settle } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.pause");
  await startFresh(api, 1);
  await api.call("press", "Escape");
  await settle(api, 150);
  check.expectEq("Esc reaches the pause screen", (await api.snapshot()).screen, "pause");
  await api.screenshot("state");
  return check.verdict();
}
