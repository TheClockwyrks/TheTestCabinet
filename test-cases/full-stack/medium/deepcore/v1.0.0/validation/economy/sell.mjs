// Automated validation for economy.sell.
//
// Selling the cargo at the Ore Market converts the whole haul to Credits at each ore's listed value
// and empties the bay. We pose a known haul, sell through the real market path, and read back.

import { newRun, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("economy.sell");

  await newRun(api);
  const before = (await api.snapshot()).credits;
  await api.call("addCargo", "cuprite", 3); // 3 x 65 Cr = 195

  await api.call("sell");
  const snap = await api.snapshot();
  check.expectEq("selling pays the haul's value in Credits", snap.credits - before, 195);
  check.expectEq("the bay is emptied after selling", snap.cargo.slotsUsed, 0);

  await liveClip(api, 500);
  return check.verdict();
}
