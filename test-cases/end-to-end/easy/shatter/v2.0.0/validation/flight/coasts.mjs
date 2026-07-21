// Automated validation for the Flight item `coasts`: releasing thrust leaves the ship
// coasting under momentum with a gentle drag (velocity halves roughly every 3 s), with
// no instant stop and no reverse. The ship is posed moving at 300 px/s with no keys
// held; the real sim is stepped and the velocity read back.
//
// The ship's pose is the precondition (`arrange`); the coast itself is the behavior (`act`),
// so the three seconds of drifting ARE the clip — a reviewer sees the ship keep gliding
// instead of stopping dead, which is exactly what the numbers assert.
//
// 0.1 s x 120 Hz = 12 ticks, then a further 2.9 s = 348 ticks for 3.0 s of coasting in total.

import { newGame, poseShip } from "../_helpers.mjs";

export default function item() {
  // The ship a moment into the coast, and after ~3 s of it, read by `assert`.
  let early;
  let late;

  return {
    id: "flight.coasts",

    async arrange(api) {
      await newGame(api);
      await poseShip(api, { x: 200, y: 200, vx: 300, vy: 0, angle: 0 });
    },

    async act(api) {
      await api.advance(12);
      early = (await api.snapshot()).ship;

      await api.advance(348); // 3.0 s total of coasting
      late = (await api.snapshot()).ship;
    },

    async assert(api, check) {
      check.expectGt(
        "the ship keeps most of its speed a moment later (no instant stop)",
        early.vx,
        250,
      );
      check.expectClose(
        "after ~3 s of drag the speed has halved to ~150 px/s",
        late.vx,
        150,
        3,
      );
      check.expectGt("the ship never reverses — it coasts forward", late.vx, 0);
      check.expectClose(
        "coasting straight adds no sideways velocity",
        late.vy,
        0,
        1e-6,
      );
    },
  };
}
