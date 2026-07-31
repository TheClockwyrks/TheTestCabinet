// Automated validation for the Bullets item `fire-rate`: fire is rate-limited (~0.18 s
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
// The gaps are written as tick counts, and both are chosen with room against the range the
// spec leaves open. `specs/ship.md` puts successive shots "at least 0.18 seconds apart" and
// bounds the rate at "roughly 5 to 6 shots per second", so a conformant interval falls
// somewhere in 0.167–0.2 s. The rejected tap lands about 0.058 s after the first shot —
// inside any of them — and the accepted one about 0.317 s after it, clear of any of them.
// FIRE_INTERVAL itself is deliberately not used to drive time: it is 21.6 ticks, not a whole
// tick count, and the contract rejects a fractional step.

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

      await api.advance(6); // 0.05 s — well inside any conformant fire interval
      tooSoon = await actTapFire(api); // too soon — must not fire

      await api.advance(30); // 0.25 s more — now clear of the interval
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
