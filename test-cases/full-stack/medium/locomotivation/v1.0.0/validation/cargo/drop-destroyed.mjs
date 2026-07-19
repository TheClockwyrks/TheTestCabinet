// Cargo: a package left ON a track is destroyed by the next train that passes over it.
// The worker drops on the row-8 track, then steps clear to safe ground; a real train is
// spawned on that lane and advanced until it passes over the package.

import { pressStep, setTile, startFresh, DT, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("cargo.drop-destroyed");

  await startFresh(api, 1);
  await setTile(api, 5, 8); // on the track
  await api.call("givePackage", { color: "red", weightClass: "parcel", archetype: "dispenser" });
  await pressStep(api, "KeyQ");
  check.expectEq("the package is resting on the track", (await api.snapshot()).ground.length, 1);

  await setTile(api, 5, 11); // step clear so only the cargo is under the train
  await api.call("spawnTrain", { line: 8, orientation: "horizontal", dir: "east", kind: "freight", headPos: 0 });
  await api.step(3.5); // run the real train over the package
  check.expectEq("the train smashed the on-track cargo", (await api.snapshot()).ground.length, 0);

  await api.step(DT);
  await liveClip(api, 600);
  return check.verdict();
}
