// Automated validation for the Controls sub-item `move-clamp`.
//
// The ship stops at the lane's edges (x 40 and 1240) and does not wrap around. A
// movement key is held long enough to reach the edge, and the real clamped update
// pins the ship there rather than wrapping.

import { startClean, SHIP_MIN_X, SHIP_MAX_X, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.move-clamp");

  // Hold left into the bound: pins at x=40, never wraps to the right edge.
  await startClean(api);
  await api.call("setShipX", 640);
  await api.call("keyDown", "ArrowLeft");
  await api.step(3);
  const left = (await api.snapshot()).ship.x;
  await api.call("keyUp", "ArrowLeft");
  check.expectClose("holding left pins the ship at the left bound", left, SHIP_MIN_X, 0.5);

  // Hold right into the bound: pins at x=1240.
  await startClean(api);
  await api.call("setShipX", 640);
  await api.call("keyDown", "ArrowRight");
  await api.step(4);
  const right = (await api.snapshot()).ship.x;
  await api.call("keyUp", "ArrowRight");
  check.expectClose("holding right pins the ship at the right bound", right, SHIP_MAX_X, 0.5);

  // A live clip of the ship pinned at the edge.
  await startClean(api);
  await api.call("setShipX", 200);
  await api.call("keyDown", "ArrowLeft");
  await clip(api, 900);
  await api.call("keyUp", "ArrowLeft");
  return check.verdict();
}
