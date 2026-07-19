// Cargo: the worker can carry several packages at once, up to the weight cap. Three
// parcels (90 of 120) are placed in reach and picked up for real, one E press each.

import { pressStep, setTile, startFresh, liveClip, W_MAX } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("cargo.multi-carry");

  await startFresh(api, 1);
  await setTile(api, 10, 12);
  for (const col of [10, 11, 9]) {
    await api.call("spawnGroundPackage", { col, row: 12, color: "green", weightClass: "parcel", archetype: "optional" });
  }

  await pressStep(api, "KeyE");
  await pressStep(api, "KeyE");
  await pressStep(api, "KeyE");
  const snap = await api.snapshot();
  check.expectEq("all three parcels are carried at once", snap.worker.carried.length, 3);
  check.expectLe("the carried load is within the cap", snap.worker.load, W_MAX);
  check.expectEq("every parcel left the ground", snap.ground.length, 0);

  await liveClip(api, 600);
  return check.verdict();
}
