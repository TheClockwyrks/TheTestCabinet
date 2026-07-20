// Automated validation for the Bullets item `inherits-motion`: a bullet carries the
// ship's own motion, so a shot fired while moving is faster than one fired at rest. The
// ship fires facing +x first at rest, then moving at +300 px/s; each bullet's launch
// velocity is read the instant it is fired (no stepping), so it reflects the muzzle
// speed plus the ship's velocity exactly.

import { newGame, poseShip, MUZZLE_SPEED, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("bullets.inherits-motion");

  await newGame(api);
  await poseShip(api, { x: 300, y: 560, vx: 0, vy: 0, angle: 0 });
  await api.call("press", "Space");
  const atRest = (await api.snapshot()).bullets[0];
  check.expectClose("a shot fired at rest leaves at the muzzle speed", atRest.vx, MUZZLE_SPEED, 1);

  await newGame(api);
  await poseShip(api, { x: 300, y: 560, vx: 300, vy: 0, angle: 0 });
  await api.call("press", "Space");
  const moving = (await api.snapshot()).bullets[0];
  check.expectClose("a shot fired while moving carries the ship's velocity", moving.vx, MUZZLE_SPEED + 300, 1);
  check.expectGt("the moving shot is faster than the at-rest shot", moving.vx, atRest.vx + 250);

  await liveClip(api, 600);
  return check.verdict();
}
