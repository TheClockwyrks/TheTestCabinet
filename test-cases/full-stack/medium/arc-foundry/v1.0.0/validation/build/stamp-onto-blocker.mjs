// Automated validation for build.stamp-onto-blocker: dropping a rock onto an existing blocker
// rerolls that blocker into a fresh candidate in place.
//
// A blocker is created the real way — an un-kept candidate hardens at wave start — then the
// wave is cleared to reopen the build phase, and a rock is stamped onto the blocker: its tile
// becomes a fresh candidate carrying the new roll.

import { startBuild, placeCandidate, towerAt, snap, clearWave, spawnControlled, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("build.stamp-onto-blocker");

  await startBuild(api);
  await api.call("setIntegrity", 999);
  const keeper = await placeCandidate(api, "capacitor", 3, 2, 7); // near entry: clears the wave fast
  await placeCandidate(api, "capacitor", 1, 10, 7); // this un-kept rock will harden into a blocker
  await api.call("keep", keeper.id); // launches Wave 1; the (10,7) rock hardens
  await clearWave(api, 200); // reopen the build phase

  let s = await snap(api);
  check.expectEq("the un-kept rock is a blocker in the reopened build phase", towerAt(s, 10, 7).kind, "blocker");

  await api.call("setNextRoll", "coil", 2);
  await api.call("placeRock", 10, 7); // stamp onto the blocker
  s = await snap(api);
  const t = towerAt(s, 10, 7);
  check.expectEq("stamping onto the blocker rerolled it into a candidate", t.kind, "candidate");
  check.expectEq("...carrying the new roll (coil)", t.type, "coil");

  await spawnControlled(api, "spark");
  await liveClip(api);
  return check.verdict();
}
