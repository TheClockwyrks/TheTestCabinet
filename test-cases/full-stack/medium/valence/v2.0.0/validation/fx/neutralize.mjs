// Automated validation for the FX sub-item `neutralize`.
//
// A produced particle burst fires when a unit is neutralized. The check poses a
// 1-electron atom under an Emitter (one hit neutralizes it) and steps until a
// "neutralize" burst appears in the live effects list.

import { coverAndSpawn, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("fx.neutralize");

  await coverAndSpawn(api, { kind: "emitter", type: "atom", electrons: 1 });
  const r = await stepUntil(api, (s) => s.effects.some((e) => e.kind === "neutralize"), 3, 0.02);
  check.expectOk("a neutralize burst fires when a unit is killed", r.hit);

  await liveClip(api, 1000);
  return check.verdict();
}
