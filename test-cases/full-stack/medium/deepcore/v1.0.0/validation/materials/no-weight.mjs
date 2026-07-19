// Automated validation for materials.no-weight.
//
// An exotic material rides in the satchel — it adds no cargo slot and no load weight. We bank a
// Resonite through the real collection path and confirm the cargo bay is unchanged.

import { newRun, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("materials.no-weight");

  await newRun(api);
  const before = await api.snapshot();
  await api.call("giveMaterial", "resonite");
  const after = await api.snapshot();

  check.expectEq("the material is in the satchel", after.satchel.resonite, 1);
  check.expectEq("it uses no cargo slot", after.cargo.slotsUsed, before.cargo.slotsUsed);
  check.expectEq("it adds no load weight", after.cargo.loadKg, before.cargo.loadKg);

  await liveClip(api, 400);
  return check.verdict();
}
