// Cargo: a package dropped off a track rests on the ground, persists, and can be picked
// back up. The worker drops on plain ground, waits (no train), then retrieves it.

import { pressStep, setTile, startFresh, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("cargo.drop-safe");

  await startFresh(api, 1);
  await setTile(api, 10, 12);
  await api.call("givePackage", { color: "red", weightClass: "parcel", archetype: "dispenser" });

  await pressStep(api, "KeyQ");
  let snap = await api.snapshot();
  check.expectEq("the dropped package rests on the ground", snap.ground.length, 1);
  check.expectEq("it left the carried set", snap.worker.carried.length, 0);

  await api.step(1.0); // time passes off-track — it must persist
  check.expectEq("the off-track package persists", (await api.snapshot()).ground.length, 1);

  await pressStep(api, "KeyE");
  snap = await api.snapshot();
  check.expectEq("the package can be picked back up", snap.worker.carried.length, 1);
  check.expectEq("the ground is clear again", snap.ground.length, 0);

  await liveClip(api, 500);
  return check.verdict();
}
