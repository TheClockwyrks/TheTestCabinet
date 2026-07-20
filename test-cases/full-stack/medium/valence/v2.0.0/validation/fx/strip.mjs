// Automated validation for the FX sub-item `strip`.
//
// A produced particle burst fires when a shell is stripped from a unit. The check poses a
// large atom under an Emitter and steps until a "strip" burst appears in the snapshot's
// live effects list. (Whether the produced burst looks good is judged by eye from the clip.)

import { coverAndSpawn, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("fx.strip");

  await coverAndSpawn(api, { kind: "emitter", type: "atom", electrons: 6 });
  const r = await stepUntil(api, (s) => s.effects.some((e) => e.kind === "strip"), 3, 0.02);
  check.expectOk("a strip-spark burst fires when a shell is stripped", r.hit);

  await liveClip(api, 1200);
  return check.verdict();
}
