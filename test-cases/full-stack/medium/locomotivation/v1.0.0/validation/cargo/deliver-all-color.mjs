// Cargo: entering a zone delivers EVERY carried package of that color at once, while
// packages of other colors stay carried. The worker carries two reds and a blue and is
// stepped onto the red zone; both reds go, the blue remains.

import { setTile, startFresh, DT, deliveredOf, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("cargo.deliver-all-color");

  await startFresh(api, 1);
  await api.call("givePackage", { color: "red", weightClass: "parcel", archetype: "dispenser" });
  await api.call("givePackage", { color: "red", weightClass: "parcel", archetype: "dispenser" });
  await api.call("givePackage", { color: "blue", weightClass: "parcel", archetype: "dispenser" });

  await setTile(api, 4, 2); // the red zone
  await api.step(DT);
  const snap = await api.snapshot();
  check.expectEq("both reds are delivered together", deliveredOf(snap, "red"), 2);
  check.expectEq("the blue package stays carried", snap.worker.carried.length, 1);
  check.expectEq("the remaining package is the blue one", snap.worker.carried[0].color, "blue");

  await liveClip(api, 500);
  return check.verdict();
}
