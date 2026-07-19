// Automated validation for the FX sub-item `bondsnap`.
//
// A produced particle burst fires when a bond snaps and a free atom is shed from a
// cluster. The check chips a Polymer with a Cleaver and steps until a "bondsnap" burst
// appears in the live effects list.

import { coverAndSpawn, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("fx.bondsnap");

  await coverAndSpawn(api, { kind: "cleaver", type: "polymer" });
  const r = await stepUntil(api, (s) => s.effects.some((e) => e.kind === "bondsnap"), 5, 0.02);
  check.expectOk("a bond-snap burst fires when an atom is shed", r.hit);

  await liveClip(api, 1300);
  return check.verdict();
}
