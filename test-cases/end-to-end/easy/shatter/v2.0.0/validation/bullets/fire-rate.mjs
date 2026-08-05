// Automated validation for the Bullets item `fire-rate`: fire is rate-limited (22 ticks
// between shots). The ship taps fire, then taps again too soon (which must NOT fire),
// then taps once more after the interval has elapsed (which must fire).
//
// Only the ship's pose is a precondition, so `arrange` is just that; the taps themselves and
// the waits BETWEEN them are the behavior under test, so they are `act` — and the clip shows
// the rejected tap and the accepted one in the order the check makes them.
//
// Each tap goes through `actTapFire`, which gives the shot one simulation tick before
// counting it: firing is a simulation event, and a build may launch the round inside `press`
// or latch the tap and launch it on the next fixed step exactly as a real key tap does.
// Counting with no time elapsed sees only the first kind and reports a conformant build of
// the second kind as never firing at all.
//
// The gaps are written as tick counts, and both are chosen with room on either side of the
// interval rather than probing its edge. `specs/ship.md` gates successive shots at 22 ticks
// — a whole number of them, so a build can hit it exactly, whether it counts ticks or seconds.
// The rejected tap lands 7 ticks after the first shot, a third of the way into the gate; the
// accepted one lands 38 ticks after it, most of a gate clear on the far side. Neither verdict
// turns on which side of a boundary a build's rounding lands, which is the point: this item
// grades that the limit EXISTS, and `bullets/max-four` relies on the same headroom to fire a
// full volley.

import { newGame, poseShip, actTapFire } from "../_helpers.mjs";

export default function item() {
  // The on-screen bullet count after each of the three taps, read by `assert`.
  let first;
  let tooSoon;
  let afterInterval;

  return {
    id: "bullets.fire-rate",

    async arrange(api) {
      await newGame(api);
      await poseShip(api, {
        x: 200,
        y: 200,
        vx: 0,
        vy: 0,
        angle: (-135 * Math.PI) / 180,
      });
    },

    async act(api) {
      first = await actTapFire(api); // first shot

      await api.advance(6); // 6 ticks — a third of the way into the 22-tick gate
      tooSoon = await actTapFire(api); // too soon — must not fire

      await api.advance(30); // 30 more ticks — 38 since the shot, well past the gate
      afterInterval = await actTapFire(api); // allowed again

      await api.advance(72); // 0.6 s tail, so the clip shows both shots in flight
    },

    async assert(api, check) {
      check.expectEq("the first tap fires a bullet", first.after, 1);
      check.expectEq(
        "a second tap within the interval does not fire",
        tooSoon.after,
        1,
      );
      check.expectEq(
        "a tap after the interval fires again",
        afterInterval.after,
        2,
      );
    },
  };
}
