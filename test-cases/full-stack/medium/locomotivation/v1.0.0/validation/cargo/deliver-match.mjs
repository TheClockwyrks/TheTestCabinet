// Cargo: carrying a package into its color-matched drop zone delivers it — the quota
// advances and the package leaves the carried set. The worker is posed carrying a red
// package (precondition) and stepped onto the red zone (4,2); the real delivery runs.

import { setTile, startFresh, DT, deliveredOf, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("cargo.deliver-match");

  await startFresh(api, 1);
  await api.call("givePackage", { color: "red", weightClass: "parcel", archetype: "dispenser" });
  check.expectEq("red delivered starts at zero", deliveredOf(await api.snapshot(), "red"), 0);

  await setTile(api, 4, 2); // the red drop zone
  await api.step(DT);
  const snap = await api.snapshot();
  check.expectEq("the matched delivery advances the red quota", deliveredOf(snap, "red"), 1);
  check.expectEq("the delivered package left the carried set", snap.worker.carried.length, 0);

  await liveClip(api, 500);
  return check.verdict();
}
