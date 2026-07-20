// Campaign: winning a level unlocks and enters the next; failing offers a retry. Level 1 is
// won for real, NEXT advances to level 2, then level 2 is failed on the clock and RETRY
// re-enters it.

import { setTile, startFresh, DT, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("campaign.progression");

  // Win level 1.
  await startFresh(api, 1);
  await api.call("setDelivered", "red", 2);
  await api.call("givePackage", { color: "red", weightClass: "parcel", archetype: "dispenser" });
  await setTile(api, 4, 2);
  await api.step(DT);
  let snap = await api.snapshot();
  check.expectEq("winning level 1 shows shift-complete", snap.screen, "level-complete");
  check.expectGe("winning unlocks the next level", snap.campaign.unlocked, 1);

  // NEXT advances to level 2.
  await api.call("press", "Enter");
  snap = await api.snapshot();
  check.expectEq("NEXT enters the next shift", snap.screen, "playing");
  check.expectEq("the next shift is level 2", snap.level.number, 2);

  // Fail level 2, then RETRY re-enters it.
  await api.call("setClock", 0.3);
  await api.step(0.5);
  check.expectEq("running the clock out fails level 2", (await api.snapshot()).screen, "level-failed");
  await api.call("press", "Enter");
  snap = await api.snapshot();
  check.expectEq("RETRY re-enters the level", snap.screen, "playing");
  check.expectEq("the retried shift is still level 2", snap.level.number, 2);

  await liveClip(api, 600);
  return check.verdict();
}
