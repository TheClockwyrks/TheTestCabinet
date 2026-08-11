// Automated validation for the Multi-ball sub-item `respawn-collision`: a ball in
// flight can collide with a ball that is respawning (waiting out its countdown, held
// at its home). The respawning ball is solid but immovable — the live ball rebounds
// off it while the held ball stays put — so respawning does not make a ball pass
// through the others.
//
// Ball 1 is driven out the goal so it respawns and waits, held, at its home; ball 0
// is then fired straight at it. The real ball-to-ball resolution runs as the
// simulation advances: the live ball must rebound without the two ever overlapping,
// and the respawning ball must not move.

import { clearPaddles, TICK } from "../_helpers.mjs";

const TWO_RADII = 22; // BALL_COLLIDE_DIST — the touch distance of two balls

export default function item() {
  // What `act` observed across its two drives, for `assert` to score.
  let respawned;
  let home;
  let minGap = Infinity;
  let after = null;

  return {
    id: "multi-ball.respawn-collision",

    // Only the first drive can be posed here: ball 0's shot has to be aimed at
    // wherever ball 1's home turns out to be, which is not known until ball 1 has
    // actually left the field and respawned.
    async arrange(api) {
      await api.reset({ seed: 11 });
      await api.call("startMatch", "versus");
      await api.call("serve");
      await api.call("setScore", 0, 0);
      await clearPaddles(api);

      // Park balls 0 and 2 out of the way, then drive ball 1 out the right goal so it
      // respawns and waits, held, at its home on the centerline.
      await api.call("setBall", 2, { x: 40, y: 40, vx: 0, vy: 0, spin: 0 });
      await api.call("setBall", 0, { x: 40, y: 690, vx: 0, vy: 0, spin: 0 });
      await api.call("setBall", 1, {
        x: 1150,
        y: 360,
        vx: 900,
        vy: 0,
        spin: 0,
      });
    },

    async act(api) {
      // 180 ticks = the old 1.5 s cap. The old chunk was 0.02 s = 2.4 ticks, which is
      // not a whole tick: poll 2 rather than 3, because a finer sweep can only sharpen
      // the instant the respawn is caught, never miss one a coarser sweep would find.
      respawned = await api.until((s) => s.balls[1].held, {
        max: 180,
        poll: 2,
      });
      home = respawned.snap.balls[1];

      // Fire ball 0 straight at the held, respawning ball 1.
      await api.call("setBall", 0, {
        x: 500,
        y: home.y,
        vx: 420,
        vy: 0,
        spin: 0,
      });

      // Sweep in small increments, tracking the closest the two centers come and the
      // moment ball 0 rebounds off the held ball. The predicate carries the tracking
      // because `until` only hands back the final snapshot.
      //
      // The old loop was 120 reads 0.01 s apart. 0.01 s is 1.2 ticks, not a whole
      // tick: poll one TICK, the finest the simulation has — the closest-approach
      // measurement can only get sharper from reading more often — and cap at 144
      // ticks so the sweep still covers the same 1.2 s window (120 x 1.2).
      await api.until(
        (s) => {
          const b0 = s.balls[0];
          const b1 = s.balls[1];
          const gap = Math.hypot(b1.x - b0.x, b1.y - b0.y);
          if (gap < minGap) minGap = gap;
          if (b0.vx < 0) {
            after = s.balls;
            return true;
          }
          return false;
        },
        { max: 144, poll: TICK },
      );

      // Stay on the rebound so the clip shows the live ball glancing away off the
      // held, respawning ball rather than cutting at the instant of contact.
      await api.advance(168); // 168 ticks = the old 1400ms clip hold
    },

    async assert(api, check) {
      check.expectOk(
        "ball 1 leaves the field and respawns, waiting held at its home",
        respawned.snap.balls[1].held,
      );
      check.expectOk(
        "the in-flight ball collides with the respawning ball and rebounds",
        after !== null,
      );
      check.expectLt(
        "the in-flight ball reverses off the respawning ball (vx)",
        after ? after[0].vx : 0,
        0,
      );
      check.expectOk(
        "the respawning ball stays held — it is solid but immovable",
        after !== null && after[1].held,
      );
      check.expectClose(
        "the respawning ball did not move (x)",
        after ? after[1].x : 0,
        home.x,
        2,
      );
      check.expectClose(
        "the respawning ball did not move (y)",
        after ? after[1].y : 0,
        home.y,
        2,
      );
      check.expectGe(
        "the balls never overlap or pass through each other (closest center gap)",
        minGap,
        TWO_RADII - 1,
      );
    },
  };
}
