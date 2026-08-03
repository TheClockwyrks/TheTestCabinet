// Automated validation for the Flight item `thrust-accelerates`: thrust accelerates
// the ship along its facing (~480 px/s^2). The ship is posed at rest facing +x on an
// empty field; the real thrust key is held while the real sim is stepped and the
// resulting velocity is read back — a stationary ship cannot gain speed on its own.
//
// The ship's pose is the precondition (`arrange`); holding thrust while the real sim runs is
// the behavior under test (`act`), so the burn IS the clip — the reviewer sees the same
// acceleration the numbers describe.
//
// The verdict is read a quarter of a second in (0.25 s x 120 Hz = 30 ticks) and the hold then
// continues to a full 1.5 s (180 ticks). The two lengths answer different questions. A quarter
// second is where the NUMBER is sharp: drag has barely bitten, so the speed is within a couple
// of px/s of the 480 px/s^2 the spec states and the ~116 px/s window below pins it. But a
// quarter second on screen is a ship that twitches and stops — far too short to read as
// acceleration at all. By 1.5 s the ship has wound up to ~608 px/s and crossed a third of the
// field, which is unmistakably a ship building speed. It is still under the 680 px/s cap
// (`specs/ship.md`), so the clip never strays into what `flight/speed-cap` exists to show, and
// the ship — free of the star's pull — flies straight past the well and stays on the field.
// The dwell runs AFTER the snapshot the assertions read, so it cannot move the verdict.

import { newGame, poseShip, actHoldKey, speedOf } from "../_helpers.mjs";

export default function item() {
  // The ship after the thrust burn, read by `assert`.
  let after;

  return {
    id: "flight.thrust-accelerates",

    async arrange(api) {
      await newGame(api);
      await poseShip(api, { x: 200, y: 200, vx: 0, vy: 0, angle: 0 });
    },

    async act(api) {
      // Measure at 30 ticks; keep thrusting to 180 so the clip is a 1.5 s burn.
      ({ after } = await actHoldKey(api, "ArrowUp", 30, { dwell: 150 }));
    },

    async assert(api, check) {
      check.expectGt("thrust builds real speed from rest", speedOf(after), 90);
      check.expectLt(
        "in a quarter second the speed is a deterministic ~116 px/s",
        speedOf(after),
        145,
      );
      check.expectGt("acceleration is along the facing (+x)", after.vx, 90);
      check.expectClose(
        "thrust along +x adds no sideways velocity",
        after.vy,
        0,
        1e-6,
      );
      check.expectOk(
        "the ship reports it is thrusting",
        after.thrusting === true,
      );
    },
  };
}
