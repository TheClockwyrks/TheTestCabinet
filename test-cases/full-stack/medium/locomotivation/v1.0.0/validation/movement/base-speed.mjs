// Movement: unladen, the worker moves at 160 px/s. On the manual clock a one-second
// hold advances the real movement code exactly one second, so the displacement is exact.

import { holdMeasure, setTile, startFresh, liveClip, V0 } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("movement.base-speed");

  await startFresh(api, 1);
  await setTile(api, 4, 12);
  const r = await holdMeasure(api, ["KeyD"], 1.0);
  check.expectClose("one second of unladen travel covers 160 px", r.dx, V0, 0.5);
  check.expectClose("the reported speed is the base speed", r.snap.worker.speed, V0, 0.5);

  await setTile(api, 4, 12);
  await api.call("keyDown", "KeyD");
  await liveClip(api, 900);
  await api.call("keyUp", "KeyD");
  return check.verdict();
}
