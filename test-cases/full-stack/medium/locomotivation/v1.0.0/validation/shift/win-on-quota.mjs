// Shift: delivering the full required quota before the clock ends completes the shift.
// Level 1 (no last train) needs three reds; two are pre-set and the real third delivery
// crosses the threshold and wins.

import { setTile, startFresh, DT, deliveredOf, settle } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("shift.win-on-quota");

  await startFresh(api, 1);
  await api.call("setDelivered", "red", 2); // one short of the quota of 3
  await api.call("givePackage", { color: "red", weightClass: "parcel", archetype: "dispenser" });

  await setTile(api, 4, 2); // the red zone — the real third delivery
  await api.step(DT);
  const snap = await api.snapshot();
  check.expectEq("the third delivery meets the quota", deliveredOf(snap, "red"), 3);
  check.expectEq("meeting the quota wins the shift", snap.phase, "won");
  check.expectEq("the shift-complete screen is shown", snap.screen, "level-complete");

  await settle(api, 150);
  await api.screenshot("result");
  return check.verdict();
}
