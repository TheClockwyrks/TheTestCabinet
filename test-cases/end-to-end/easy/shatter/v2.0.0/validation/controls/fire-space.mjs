// Automated validation for the Controls item `fire-space`: Space fires a bullet. The ship
// is posed in play; Space is tapped and a new bullet must appear. Injected input flows
// through the real key handling.
//
// The ship's pose is the precondition (`arrange`). The tap itself is instant, but it is the
// behavior under test, so it stays in `act` — that way the clip actually shows the shot being
// taken and flying, rather than opening on a bullet that is already in the air.

import { newGame, poseShip } from "../_helpers.mjs";

export default function item() {
  // The bullet count before and after the tap, read by `assert`.
  let before;
  let after;

  return {
    id: "controls.fire-space",

    async arrange(api) {
      await newGame(api);
      await poseShip(api, { x: 300, y: 560, vx: 0, vy: 0, angle: 0 });
    },

    async act(api) {
      before = (await api.snapshot()).bullets.length;
      await api.call("press", "Space");
      after = (await api.snapshot()).bullets.length;
      // Let the shot fly so the clip shows it leave the ship: 0.6 s x 120 Hz = 72 ticks.
      await api.advance(72);
    },

    async assert(api, check) {
      check.expectEq("no bullets before firing", before, 0);
      check.expectEq("tapping Space fires a bullet", after, 1);
    },
  };
}
