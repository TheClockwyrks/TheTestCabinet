// Automated validation for the Controls item `fire-space`: Space fires a bullet. The ship
// is posed in play; Space is tapped and a new bullet must appear. Injected input flows
// through the real key handling.
//
// The ship's pose is the precondition (`arrange`). The tap itself is the behavior under
// test, so it stays in `act` — that way the clip actually shows the shot being taken and
// flying, rather than opening on a bullet that is already in the air.
//
// The tap is read through `actTapFire`, which gives the shot one simulation tick before
// counting it. `specs/instrumentation.md` puts firing among the one-shot actions a key applies
// on the press itself, and sanctions either shape that follows from it — launching the round
// inside `keyDown`, or latching the request there and launching it on the next fixed step.
// Counting bullets with no time elapsed sees only the first shape and would fail the second
// for a shot it does fire; one tick sees both. A build that instead samples the fire key's
// HELD state on the step answers a tap with nothing, which is the fault this reports.

import { newGame, poseShip, actTapFire } from "../_helpers.mjs";

export default function item() {
  // The bullet counts either side of the tap, read by `assert`.
  let shot;

  return {
    id: "controls.fire-space",

    async arrange(api) {
      await newGame(api);
      await poseShip(api, { x: 300, y: 560, vx: 0, vy: 0, angle: 0 });
    },

    async act(api) {
      shot = await actTapFire(api);
      // Let the shot fly so the clip shows it leave the ship: 0.6 s x 120 Hz = 72 ticks.
      await api.advance(72);
    },

    async assert(api, check) {
      check.expectEq("no bullets before firing", shot.before, 0);
      check.expectEq("tapping Space fires a bullet", shot.after, 1);
    },
  };
}
