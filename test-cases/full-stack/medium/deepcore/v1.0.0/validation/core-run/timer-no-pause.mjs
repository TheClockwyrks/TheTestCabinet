// Automated validation for core-run.timer-no-pause.
//
// The Core Sample countdown keeps running while a panel or the inventory is open — there is no free
// pause. We extract the Sample, open the inventory, and confirm the timer still falls with stepped
// time behind the open overlay.

import { newRun, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("core-run.timer-no-pause");

  await newRun(api);
  await api.call("spawnCoreSample");
  await api.call("openInventory");
  const s0 = await api.snapshot();
  check.expectEq("the inventory overlay is open", s0.panel, "inventory");
  const t0 = s0.coreTimer;

  await api.step(5);
  const s1 = await api.snapshot();
  check.expectEq("the overlay is still open", s1.panel, "inventory");
  check.expectClose("the timer kept running behind the overlay", t0 - s1.coreTimer, 5, 0.5);

  await liveClip(api, 600);
  return check.verdict();
}
