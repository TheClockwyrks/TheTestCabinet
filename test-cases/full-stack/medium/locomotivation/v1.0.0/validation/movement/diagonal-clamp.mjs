// Movement: holding two perpendicular directions moves diagonally at the BASE speed,
// not faster — the diagonal magnitude is clamped to V0 (each axis V0/sqrt2), so there
// is no diagonal speed bonus.

import { holdMeasure, setTile, startFresh, liveClip, V0 } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("movement.diagonal-clamp");

  await startFresh(api, 1);
  await setTile(api, 8, 10);
  const r = await holdMeasure(api, ["KeyD", "KeyS"], 1.0);
  const mag = Math.hypot(r.dx, r.dy);
  check.expectClose("diagonal travel magnitude equals the base speed, not faster", mag, V0, 0.6);
  check.expectClose("each axis carries V0/sqrt2", r.dx, V0 / Math.SQRT2, 0.6);
  check.expectClose("the diagonal is even (dx == dy)", r.dx, r.dy, 0.01);

  await setTile(api, 8, 10);
  await api.call("keyDown", "KeyD");
  await api.call("keyDown", "KeyS");
  await liveClip(api, 800);
  await api.call("keyUp", "KeyD");
  await api.call("keyUp", "KeyS");
  return check.verdict();
}
