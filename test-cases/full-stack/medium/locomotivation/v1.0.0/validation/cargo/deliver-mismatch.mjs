// Cargo: a drop zone delivers nothing for a package of the wrong color. A blue package is
// carried onto the RED zone (4,2); nothing is delivered and the blue package stays carried.

import { setTile, startFresh, DT, deliveredOf, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("cargo.deliver-mismatch");

  await startFresh(api, 1);
  await api.call("givePackage", { color: "blue", weightClass: "parcel", archetype: "dispenser" });

  await setTile(api, 4, 2); // the RED zone, wrong for a blue package
  await api.step(DT);
  const snap = await api.snapshot();
  check.expectEq("the wrong-color package stays carried", snap.worker.carried.length, 1);
  check.expectEq("the red quota does not advance", deliveredOf(snap, "red"), 0);

  await liveClip(api, 500);
  return check.verdict();
}
