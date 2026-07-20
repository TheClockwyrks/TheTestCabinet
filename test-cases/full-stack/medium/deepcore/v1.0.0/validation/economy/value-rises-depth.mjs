// Automated validation for economy.value-rises-depth.
//
// A deep ore sells for many times a shallow one. We sell one unit of the shallowest ore and one of
// the deepest, reading the Credits each fetches through the real market path.

import { newRun, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("economy.value-rises-depth");

  await newRun(api);
  const c0 = (await api.snapshot()).credits;
  await api.call("addCargo", "ferron", 1); // shallowest ore
  await api.call("sell");
  const shallow = (await api.snapshot()).credits - c0;

  const c1 = (await api.snapshot()).credits;
  await api.call("addCargo", "adamite", 1); // deepest ore
  await api.call("sell");
  const deep = (await api.snapshot()).credits - c1;

  check.expectGt("a shallow ore is worth a little", shallow, 0);
  check.expectGt("a deep ore is worth far more", deep, shallow * 10);

  await liveClip(api, 500);
  return check.verdict();
}
