// Automated validation for the Controls item `fire-space`: Space fires a bullet. The ship
// is posed in play; Space is tapped and a new bullet must appear. Injected input flows
// through the real key handling.
//
// The ship's pose is the precondition (`arrange`). The tap itself is the behavior under
// test, so it stays in `act` — that way the clip actually shows the shot being taken and
// flying, rather than opening on a bullet that is already in the air.
//
// The tap is read through `actTapFire`, which gives the shot one simulation tick before
// counting it. Firing is a simulation event: a build may launch the round inside `press` or
// latch the tap and launch it on the next fixed step exactly as a real key tap does, and
// `specs/instrumentation.md` sanctions both (the one-shot actions it says are applied
// immediately are the menu, pause and mute ones). Counting bullets with no time elapsed sees
// only the first kind and fails the second for a shot it does fire.

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
