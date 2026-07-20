// Controls: Q sets down the most-recently carried package. A package is placed in the
// carried set as a precondition; the real drop runs when Q's edge is sampled.

import { pressStep, setTile, startFresh, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.drop");

  await startFresh(api, 1);
  await setTile(api, 10, 12);
  await api.call("givePackage", { color: "red", weightClass: "parcel", archetype: "dispenser" });
  check.expectEq("carrying one before the drop", (await api.snapshot()).worker.carried.length, 1);

  await pressStep(api, "KeyQ");
  const snap = await api.snapshot();
  check.expectEq("pressing Q sets the package down", snap.worker.carried.length, 0);
  check.expectEq("the package landed on the ground", snap.ground.length, 1);

  await liveClip(api, 700);
  return check.verdict();
}
