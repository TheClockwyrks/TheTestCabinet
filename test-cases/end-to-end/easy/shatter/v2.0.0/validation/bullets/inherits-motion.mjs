// Automated validation for the Bullets item `inherits-motion`: a bullet carries the
// ship's own motion, so a shot fired while moving is faster than one fired at rest. The
// ship fires facing +x first at rest, then moving at +300 px/s, and the two launch
// velocities are compared.
//
// Both shots are taken in `act`, in ONE game, with the field emptied between them: each
// launch velocity is read while exactly one bullet is on the field, so "the bullet that was
// just fired" is never a guess about which end of the list a build appends to. Waiting the
// first shot out rather than resetting between the two also keeps the clip continuous — the
// slow shot crosses and expires, then the fast one leaves visibly harder.
//
// Each tap goes through `actTapFire`, which gives the shot one simulation tick before reading
// it. A build may launch the round inside `press` or latch the tap and launch it on the next
// fixed step, and both are conformant (`specs/instrumentation.md`); reading with no time
// elapsed sees no bullet at all on the second kind. That tick costs at most a fraction of a
// px/s of gravity on the round, which the tolerances below absorb.
//
// A tap that produces NO bullet is a failure of this item, not a crash in it. Reading a launch
// velocity straight off `shot.bullet` threw a bare `Cannot read properties of undefined
// (reading 'vx')` on a build whose gun never answered the tap, and the driver reports a throw
// out of a check as the script never having RUN — so the one thing the run had actually proved
// (the shot was never taken) was reported as "the build exposed the debug API this check
// drives", which is both wrong and useless to whoever reads it. Each shot is therefore
// asserted to exist first, and the velocity comparisons read through `launch`, which
// substitutes a sentinel rather than throwing. The verdict is the same either way; only the
// reason it gives changes.

import {
  newGame,
  poseShip,
  actTapFire,
  MUZZLE_SPEED,
  TICK,
  ticks,
} from "../_helpers.mjs";

const DRIFT = 300; // px/s of ship motion the second shot must carry

/**
 * The launch velocity of the round `shot` produced, or `NaN` if the tap produced no
 * round at all. `NaN` fails every comparison below without throwing, so a gun that
 * never answered is reported as the wrong launch speed it is, next to the assertion
 * that already said no bullet was fired.
 */
function launch(shot) {
  return shot.bullet ? shot.bullet.vx : Number.NaN;
}

export default function item() {
  // The two shots, compared by `assert`.
  let atRest;
  let moving;
  let cleared;

  return {
    id: "bullets.inherits-motion",

    async arrange(api) {
      // Low and to the left, so both shots have a clear runway across the field and
      // neither passes close enough to the star for gravity to muddy the comparison.
      await newGame(api);
      await poseShip(api, { x: 200, y: 620, vx: 0, vy: 0, angle: 0 });
    },

    async act(api) {
      // Shot one: fired from a standstill, so it leaves at the muzzle speed alone.
      atRest = await actTapFire(api);

      // Let it run out, so the second shot is again the only bullet on the field.
      cleared = await api.until((s) => s.bullets.length === 0, {
        max: ticks(2.5),
        poll: TICK,
      });

      // Shot two: the same shot from a ship already moving along its facing.
      await poseShip(api, { x: 200, y: 620, vx: DRIFT, vy: 0, angle: 0 });
      moving = await actTapFire(api);

      await api.advance(72); // 0.6 s tail, so the clip shows the faster shot pull away
    },

    async assert(api, check) {
      check.expectEq(
        "the first shot is the only bullet on the field",
        atRest.after,
        1,
      );
      check.expectOk("the first shot clears the field again", cleared.hit);
      check.expectEq(
        "the second shot is fired onto an empty field",
        moving.before,
        0,
      );

      // Both taps must have produced a round before any launch speed means anything.
      check.expectOk("the at-rest tap fires a round", Boolean(atRest.bullet));
      check.expectOk("the moving tap fires a round", Boolean(moving.bullet));

      check.expectClose(
        "a shot fired at rest leaves at the muzzle speed",
        launch(atRest),
        MUZZLE_SPEED,
        2,
      );
      check.expectClose(
        "a shot fired while moving carries the ship's velocity",
        launch(moving),
        MUZZLE_SPEED + DRIFT,
        2,
      );
      check.expectGt(
        "the moving shot is faster than the at-rest shot",
        launch(moving),
        launch(atRest) + 250,
      );
    },
  };
}
