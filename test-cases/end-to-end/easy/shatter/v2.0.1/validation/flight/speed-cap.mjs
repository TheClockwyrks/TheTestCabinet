// Automated validation for the Flight item `speed-cap`: thrust cannot drive the ship
// past its speed cap (~680 px/s). The ship thrusts continuously for several seconds
// while the real sim is stepped; its speed is sampled throughout and must plateau at
// ~680 and never exceed it.
//
// The ship's pose is the precondition (`arrange`); holding thrust and sampling the speed as it
// climbs is the behavior (`act`), so the burn IS the clip — the reviewer watches the ship
// accelerate and then visibly stop getting faster.
//
// The sweep stays a loop because it tracks the fastest speed seen across the whole burn, which
// a single long advance would step straight over. 50 samples x 0.1 s = 5 s, i.e. 50 x 12 ticks.
//
// The plateau is checked as a BAND rather than as 680 on the nose. `specs/ship.md` fixes the
// cap ("applied after thrust each step") and the drag ("each step multiply the ship's velocity
// by 0.5 ^ (dt / 3.0)") but never says which of the two a step ends on. Clamp-then-drag ends a
// step at 678.69; drag-then-clamp ends it at 680. Both clamp after thrust, both reach the cap,
// and neither ever passes it, so both are conformant and the difference is not something the
// case gets to decide. The band is exactly one step of drag wide (`SHIP_MAX_PLATEAU`), which
// admits both and still rejects a build that plateaus anywhere genuinely short of the ceiling.

import {
  newGame,
  poseShip,
  speedOf,
  SHIP_MAX,
  SHIP_MAX_PLATEAU,
} from "../_helpers.mjs";

export default function item() {
  // The fastest speed seen across the burn, and the ship it ended on, read by `assert`.
  let maxSpeed;
  let final;

  return {
    id: "flight.speed-cap",

    async arrange(api) {
      await newGame(api);
      await poseShip(api, { x: 200, y: 500, vx: 0, vy: 0, angle: 0 });
    },

    async act(api) {
      await api.call("keyDown", "ArrowUp");

      maxSpeed = 0;
      for (let i = 0; i < 50; i += 1) {
        await api.advance(12); // 0.1 s a sample, 5 s of continuous thrust in total
        maxSpeed = Math.max(maxSpeed, speedOf((await api.snapshot()).ship));
      }
      final = (await api.snapshot()).ship;
      await api.call("keyUp", "ArrowUp");
    },

    async assert(api, check) {
      check.expectLe(
        "the ship never exceeds the ~680 px/s cap",
        maxSpeed,
        SHIP_MAX + 0.5,
      );
      check.expectGe(
        "thrusting flat out, the ship plateaus at the cap",
        speedOf(final),
        SHIP_MAX_PLATEAU - 0.5,
      );
      check.expectLe(
        "and does not sit above it",
        speedOf(final),
        SHIP_MAX + 0.5,
      );
    },
  };
}
