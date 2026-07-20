// Controls: Esc during a live shift opens the pause screen.

import { startFresh, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.pause");

  await startFresh(api, 1);
  check.expectEq("the shift is live before the pause", (await api.snapshot()).screen, "playing");
  await api.call("press", "Escape");
  check.expectEq("pressing Esc pauses the shift", (await api.snapshot()).screen, "pause");

  await api.wait(700);
  return check.verdict();
}
