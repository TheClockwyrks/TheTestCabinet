// Automated validation for the Bullets item `inherits-motion`: a bullet carries the
// ship's own motion, so a shot fired while moving is faster than one fired at rest. The
// ship fires facing +x first at rest, then moving at +300 px/s; each bullet's launch
// velocity is read the instant it is fired (no stepping), so it reflects the muzzle
// speed plus the ship's velocity exactly.
//
// Both measurements are INSTANT — the launch velocity is read the moment the shot leaves,
// before any time passes — and the two scenarios are separated by a fresh game (a reset,
// which only `arrange` may call). So both drives live in `arrange`, and `act` flies the
// second, faster shot so the clip shows the moving ship's bullet outrunning the ship.

import { newGame, poseShip, MUZZLE_SPEED } from "../_helpers.mjs";

export default function item() {
  // The two launch velocities, compared by `assert`.
  let atRest;
  let moving;

  return {
    id: "bullets.inherits-motion",

    async arrange(api) {
      // Shot one: fired from a standstill, so it leaves at the muzzle speed alone.
      await newGame(api);
      await poseShip(api, { x: 300, y: 560, vx: 0, vy: 0, angle: 0 });
      await api.call("press", "Space");
      atRest = (await api.snapshot()).bullets[0];

      // Shot two: the same shot from a ship already moving along its facing.
      await newGame(api);
      await poseShip(api, { x: 300, y: 560, vx: 300, vy: 0, angle: 0 });
      await api.call("press", "Space");
      moving = (await api.snapshot()).bullets[0];
    },

    async act(api) {
      // Let the faster, motion-carrying shot fly: 0.6 s x 120 Hz = 72 ticks.
      await api.advance(72);
    },

    async assert(api, check) {
      check.expectClose(
        "a shot fired at rest leaves at the muzzle speed",
        atRest.vx,
        MUZZLE_SPEED,
        1,
      );
      check.expectClose(
        "a shot fired while moving carries the ship's velocity",
        moving.vx,
        MUZZLE_SPEED + 300,
        1,
      );
      check.expectGt(
        "the moving shot is faster than the at-rest shot",
        moving.vx,
        atRest.vx + 250,
      );
    },
  };
}
