// Cargo: dying on a track destroys EVERYTHING the worker was carrying in that same
// collision. The worker is posed on a lane carrying two packages; a train is spawned
// already overlapping it and one step kills it — the carried set is wiped.

import { setTile, startFresh, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("cargo.death-drop");

  await startFresh(api, 1);
  await setTile(api, 8, 10);
  await api.call("givePackage", { color: "red", weightClass: "parcel", archetype: "dispenser" });
  await api.call("givePackage", { color: "blue", weightClass: "parcel", archetype: "dispenser" });
  check.expectEq("carrying two before the collision", (await api.snapshot()).worker.carried.length, 2);

  // A train already over the worker's lane position; one step resolves the lethal hit.
  await api.call("spawnTrain", { line: 10, orientation: "horizontal", dir: "east", kind: "freight", headPos: 400 });
  await api.step(0.1);
  const snap = await api.snapshot();
  check.expectEq("the collision wiped the carried load", snap.worker.carried.length, 0);
  check.expectEq("the death cost a life", snap.level.lives, 2);

  await liveClip(api, 600);
  return check.verdict();
}
