// Automated validation for the FX sub-item `split`.
//
// A produced particle burst fires when a heavy isotope decays and sheds a fragment. The
// check cracks a heavy with a Reactor and steps until a "split" burst appears in the live
// effects list.

import { coverAndSpawn, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("fx.split");

  await coverAndSpawn(api, { kind: "reactor", type: "isotope" });
  const r = await stepUntil(api, (s) => s.effects.some((e) => e.kind === "split"), 5, 0.02);
  check.expectOk("a split-flash burst fires when a heavy decays", r.hit);

  await liveClip(api, 1300);
  return check.verdict();
}
