// Movement: releasing the direction key stops the worker at once — no sliding. Movement
// is read directly from held input each step, so a released key means zero displacement.

import { setTile, startFresh, DT, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("movement.no-momentum");

  await startFresh(api, 1);
  await setTile(api, 6, 12);
  await api.call("keyDown", "KeyD");
  await api.step(0.3);
  const moving = await api.snapshot();
  check.expectEq("the worker is moving while the key is held", moving.worker.moving, true);

  await api.call("keyUp", "KeyD");
  const xAtRelease = moving.worker.x;
  await api.step(0.3); // real time after release
  const after = await api.snapshot();
  check.expectClose("the worker does not slide after release (Δx)", after.worker.x - xAtRelease, 0, 0.01);
  check.expectEq("the worker is no longer moving", after.worker.moving, false);

  await setTile(api, 6, 12);
  await api.call("keyDown", "KeyD");
  await liveClip(api, 500);
  await api.call("keyUp", "KeyD");
  await api.wait(400);
  return check.verdict();
}
