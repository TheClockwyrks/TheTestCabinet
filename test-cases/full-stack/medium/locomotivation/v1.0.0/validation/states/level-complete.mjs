// State: the shift-complete summary is reachable by winning a level.

import { setTile, startFresh, DT, settle } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.level-complete");
  await startFresh(api, 1);
  await api.call("setDelivered", "red", 2);
  await api.call("givePackage", { color: "red", weightClass: "parcel", archetype: "dispenser" });
  await setTile(api, 4, 2);
  await api.step(DT);
  await settle(api, 150);
  check.expectEq("winning reaches the shift-complete screen", (await api.snapshot()).screen, "level-complete");
  await api.screenshot("state");
  return check.verdict();
}
