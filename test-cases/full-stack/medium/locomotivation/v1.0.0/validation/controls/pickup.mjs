// Controls: E (or Space) lifts an adjacent package. A ground package is placed in reach
// as a precondition; the real pickup runs when E's edge is sampled, growing the carried set.

import { pressStep, setTile, startFresh, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.pickup");

  await startFresh(api, 1);
  await setTile(api, 10, 12);
  await api.call("spawnGroundPackage", { col: 10, row: 12, color: "red", weightClass: "parcel", archetype: "optional" });
  check.expectEq("nothing carried before the pickup", (await api.snapshot()).worker.carried.length, 0);

  await pressStep(api, "KeyE");
  const snap = await api.snapshot();
  check.expectEq("pressing E lifts the adjacent package", snap.worker.carried.length, 1);
  check.expectEq("the package left the ground", snap.ground.length, 0);

  await liveClip(api, 700);
  return check.verdict();
}
