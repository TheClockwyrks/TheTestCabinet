// Shift: the clock reaching zero with the quota unmet fails the shift (out of time). The
// clock is set to a sliver as a precondition and run out; the real fail rule resolves it.

import { startFresh, settle } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("shift.fail-time");

  await startFresh(api, 1);
  await api.call("setClock", 0.5);

  await api.step(1.0); // run the clock out with the quota unmet
  const snap = await api.snapshot();
  check.expectEq("the clock ran out into a failed shift", snap.screen, "level-failed");
  check.expectEq("the failure reason is out of time", snap.level.failReason, "out-of-time");

  await settle(api, 150);
  await api.screenshot("result");
  return check.verdict();
}
