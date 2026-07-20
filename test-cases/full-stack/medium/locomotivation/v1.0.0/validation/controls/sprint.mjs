// Controls: holding Shift while moving (unladen, charged) multiplies speed by ~1.6x.
// The worker is unladen, so sprint is available; the snapshot's speed and sprinting
// flag are read straight off the real movement step.

import { holdMeasure, liveClip, setTile, startFresh, V0, SPRINT_MULT } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.sprint");

  await startFresh(api, 1);
  await setTile(api, 4, 12);
  const r = await holdMeasure(api, ["KeyD", "ShiftLeft"], 0.3);
  check.expectEq("holding Shift while moving sprints", r.snap.worker.sprinting, true);
  check.expectClose("sprint speed is base x 1.6", r.snap.worker.speed, V0 * SPRINT_MULT, 0.5);
  check.expectLt("sprinting drains the sprint charge", r.snap.worker.sprintCharge, 1.6);

  await setTile(api, 4, 12);
  await api.call("keyDown", "KeyD");
  await api.call("keyDown", "ShiftLeft");
  await liveClip(api, 800);
  await api.call("keyUp", "ShiftLeft");
  await api.call("keyUp", "KeyD");

  return check.verdict();
}
