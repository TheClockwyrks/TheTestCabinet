// Automated validation for build.cancel-free: cancelling a held (un-dropped) rock costs no
// stamp and no Charge.
//
// The press is pulled with the B key (arming a held rock), then cancelled with Esc; the stamp
// allowance and Charge are unchanged and no rock remains held.

import { startBuild, snap } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("build.cancel-free");

  const s0 = await startBuild(api);

  await api.call("press", "KeyB"); // pull the press → a blank rock is held
  const s1 = await snap(api);
  check.expectOk("a rock is held after pulling the press", !!s1.held && s1.held.active);

  await api.call("press", "Escape"); // cancel the held rock
  const s2 = await snap(api);
  check.expectOk("no rock is held after cancelling", !s2.held || !s2.held.active);
  check.expectEq("cancelling spends no stamp", s2.stampsLeft, s0.stampsLeft);
  check.expectEq("cancelling costs no Charge", s2.charge, s0.charge);

  await api.screenshot("cancel");
  return check.verdict();
}
