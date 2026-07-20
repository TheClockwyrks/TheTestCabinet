// Movement: a load up to ~50% of the cap imposes no penalty. Two parcels (60 of 120,
// w = 0.5) leave the worker at the full base speed. The load is a precondition; the
// real speed model then runs forward.

import { holdMeasure, setTile, startFresh, liveClip, V0 } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("movement.weight-full");

  await startFresh(api, 1);
  await setTile(api, 4, 12);
  await api.call("givePackage", { color: "red", weightClass: "parcel", archetype: "dispenser" });
  await api.call("givePackage", { color: "red", weightClass: "parcel", archetype: "dispenser" });
  check.expectClose("half-cap load fraction", (await api.snapshot()).worker.loadFraction, 0.5, 1e-6);

  const r = await holdMeasure(api, ["KeyD"], 0.5);
  check.expectClose("half-laden speed is still the full base speed", r.snap.worker.speed, V0, 0.5);
  check.expectClose("half a second covers 80 px unpenalized", r.dx, V0 * 0.5, 0.5);
  check.expectEq("sprint is not locked at half load", r.snap.worker.sprintLocked, false);

  await setTile(api, 4, 12);
  await api.call("keyDown", "KeyD");
  await liveClip(api, 700);
  await api.call("keyUp", "KeyD");
  return check.verdict();
}
