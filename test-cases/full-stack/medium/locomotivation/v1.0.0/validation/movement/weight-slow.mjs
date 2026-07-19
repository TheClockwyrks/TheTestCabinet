// Movement: a load in the mid band (~50%–80%) slows the worker on a smooth ramp, with
// sprint still available. One "load" package (80 of 120, w ≈ 0.667) puts the worker in
// the band; the real speed model yields ~0.833x the base speed.

import { holdMeasure, setTile, startFresh, liveClip, expectedSpeed, WEIGHT } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("movement.weight-slow");
  const expected = expectedSpeed(WEIGHT.load); // ~133.33 px/s

  await startFresh(api, 1);
  await setTile(api, 4, 12);
  await api.call("givePackage", { color: "red", weightClass: "load", archetype: "dispenser" });
  const laden = await api.snapshot();
  check.expectGt("mid-band load fraction is over half", laden.worker.loadFraction, 0.5);
  check.expectLt("mid-band load fraction is under the sprint-lock threshold", laden.worker.loadFraction, 0.8);

  const r = await holdMeasure(api, ["KeyD"], 0.5);
  check.expectClose("mid-band speed is the ramped value", r.snap.worker.speed, expected, 0.5);
  check.expectClose("half a second covers the ramped distance", r.dx, expected * 0.5, 0.5);
  check.expectEq("sprint is still available in the mid band", r.snap.worker.sprintLocked, false);

  await setTile(api, 4, 12);
  await api.call("keyDown", "KeyD");
  await liveClip(api, 700);
  await api.call("keyUp", "KeyD");
  return check.verdict();
}
