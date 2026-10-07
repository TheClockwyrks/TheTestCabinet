// Automated validation for the Multi-ball sub-item `respawn-collision`: a ball in
// flight can collide with a ball that is respawning (waiting out its countdown, held
// at its home). The respawning ball is solid but immovable — the live ball rebounds
// off it while the held ball stays put — so respawning does not make a ball pass
// through the others.
//
// Ball 1 is driven out the goal so it respawns and waits, held, at its home, and ball
// 0 is lined up short of it aimed straight at it. The real ball-to-ball resolution
// then runs as the simulation advances: the live ball must rebound without the two
// ever overlapping and without crossing to the far side, and the respawning ball must
// not move.

import { clearPaddles, TICK } from "../_helpers.mjs";

const TWO_RADII = 22; // BALL_COLLIDE_DIST — the touch distance of two balls

// The shot fired at the respawning ball: how far short of its home ball 0 starts, and
// how fast it closes. 160 px at 420 px/s is 0.32 s of flight, so the clip opens on a
// ball already travelling and reaches contact in well under a second.
const SHOT_RUN_UP = 160;
const SHOT_SPEED = 420;

// The flight is split so that only the part that has to be read at tick resolution
// costs a read per tick. `advance` is a single wall-clock pause in the record pass,
// where `until` pays a snapshot round trip per poll — polling the whole run-up at one
// tick (8.3 ms of game time against a round trip an order of magnitude longer) makes
// the recording's length a function of the host rather than the game. So fly most of
// the run-up in one `advance` and sweep only the last stretch, where the closest
// approach and the rebound actually happen.
//
// Contact is at SHOT_RUN_UP - TWO_RADII = 138 px, or 39.4 ticks. Fly 32 and sweep 24:
// the sweep opens ~7 ticks (25 px) short of contact and runs ~16 ticks past it.
const RUN_UP_TICKS = 32;
const CONTACT_SWEEP_TICKS = 24;

// A tail on the rebound, kept short of the ~120-tick hold the respawning ball has been
// waiting out since `arrange` left it held, so the clip ends on the live ball glancing
// away with the held ball still sitting at its home rather than on the held ball
// launching itself. Contact lands around tick 40, so this leaves ~20 ticks in hand.
const TAIL_TICKS = 60;

export default function item() {
  // What `arrange` posed and `act` observed, for `assert` to score.
  let respawned;
  let home;
  let minGap = Infinity;
  let maxX = -Infinity;
  let after = null;

  return {
    id: "multi-ball.respawn-collision",

    // Both drives are posed here: the respawn is the journey to the evidence rather
    // than the evidence, and `skipUntil` runs the same real simulation instantly in
    // both passes, so the clip opens on ball 0's shot instead of on ball 1 leaving the
    // field. Ball 0's aim needs ball 1's home, which is not known until ball 1 has
    // actually left and respawned — hence the sweep, then the pose.
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
      await api.call("reconcile");
      // 180 ticks = 1.5 s, far longer than the ~0.2 s the ball needs to cross the
      // goal edge; poll 2, because a finer sweep can only sharpen the instant the
      // respawn is caught, never miss one a coarser sweep would find.
      respawned = await api.skipUntil((s) => s.balls[1].held, {
        max: 180,
        poll: 2,
      });
      home = respawned.snap.balls[1];

      // Line ball 0 up short of the held, respawning ball, aimed straight at it.
      await api.call("setBall", 0, {
        x: home.x - SHOT_RUN_UP,
        y: home.y,
        vx: SHOT_SPEED,
        vy: 0,
        spin: 0,
      });
      await api.call("reconcile");
    },

    // The shot, the contact, and the rebound — the whole of what the item claims, and
    // all of what the clip contains.
    async act(api) {
      await api.advance(RUN_UP_TICKS);

      // Sweep the contact itself a tick at a time, tracking the closest the two
      // centers come, how far right the live ball reached, and the moment it rebounds.
      // The predicate carries the tracking because `until` only hands back the final
      // snapshot.
      await api.until(
        (s) => {
          const b0 = s.balls[0];
          const b1 = s.balls[1];
          const gap = Math.hypot(b1.x - b0.x, b1.y - b0.y);
          if (gap < minGap) minGap = gap;
          if (b0.x > maxX) maxX = b0.x;
          if (b0.vx < 0) {
            after = s.balls;
            return true;
          }
          return false;
        },
        { max: CONTACT_SWEEP_TICKS, poll: TICK },
      );

      // Stay on the rebound so the clip shows the live ball glancing away off the
      // held, respawning ball rather than cutting at the instant of contact.
      await api.advance(TAIL_TICKS);
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
      // The gap alone cannot see a build that resolves the overlap by teleporting the
      // live ball out the FAR side: it is never closer than a touch, and never
      // rebounds. The live ball approaches from the left, so it must never reach the
      // held ball's center.
      check.expectLt(
        "the in-flight ball never crosses to the far side of the respawning ball (x)",
        maxX,
        home.x,
      );
    },
  };
}
