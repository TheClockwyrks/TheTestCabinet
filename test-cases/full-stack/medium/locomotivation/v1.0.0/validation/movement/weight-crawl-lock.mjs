// Movement: a load over ~80% of the cap slows the worker further AND locks out sprint
// entirely. A "load" + a "parcel" (110 of 120, w ≈ 0.917) crawls, and holding Shift does
// nothing — the worker never sprints.

import { holdMeasure, setTile, startFresh, liveClip, expectedSpeed, WEIGHT } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("movement.weight-crawl-lock");
  const crawl = expectedSpeed(WEIGHT.load + WEIGHT.parcel); // ~93.33 px/s, no sprint

  await startFresh(api, 1);
  await setTile(api, 4, 12);
  await api.call("givePackage", { color: "red", weightClass: "load", archetype: "dispenser" });
  await api.call("givePackage", { color: "red", weightClass: "parcel", archetype: "dispenser" });
  const laden = await api.snapshot();
  check.expectGt("the load fraction is over the sprint-lock threshold", laden.worker.loadFraction, 0.8);
  check.expectEq("sprint reports locked over 80% load", laden.worker.sprintLocked, true);

  // Hold Shift too — it must be ignored while locked.
  const r = await holdMeasure(api, ["KeyD", "ShiftLeft"], 0.5);
  check.expectEq("holding Shift does not sprint while locked", r.snap.worker.sprinting, false);
  check.expectClose("the overloaded crawl speed", r.snap.worker.speed, crawl, 0.5);
  check.expectClose("the crawl covers only the reduced distance", r.dx, crawl * 0.5, 0.5);

  await setTile(api, 4, 12);
  await api.call("keyDown", "KeyD");
  await api.call("keyDown", "ShiftLeft");
  await liveClip(api, 800);
  await api.call("keyUp", "KeyD");
  await api.call("keyUp", "ShiftLeft");
  return check.verdict();
}
