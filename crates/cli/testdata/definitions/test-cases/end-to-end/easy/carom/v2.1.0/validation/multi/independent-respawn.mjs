// Automated validation for the Multi-ball sub-item `independent-respawn`: a ball
// that leaves the field respawns on its own while the others keep playing.
//
// The two other balls are parked, still, out of the way, then ball 0 is driven out
// the right goal. After it crosses, ball 0 must be back at its home counting down
// (held) while the other two are untouched and still in play — the respawn is
// per-ball, not a whole-field reset.

import { clearPaddles } from "../_helpers.mjs";

export default function item() {
  // The snapshot at the moment ball 0 respawned, for `assert` to score.
  let snap;

  return {
    id: "multi-ball.independent-respawn",

    async arrange(api) {
      await api.reset({ seed: 5 });
      await api.call("startMatch", "versus");
      await api.call("serve");
      await api.call("setScore", 0, 0);
      // Clear the paddles out of the lane so ball 0 reaches the goal cleanly.
      await clearPaddles(api);

      // Park balls 1 and 2 still, out of every lane, so only ball 0 leaves the field.
      await api.call("setBall", 1, { x: 30, y: 30, vx: 0, vy: 0, spin: 0 });
      await api.call("setBall", 2, { x: 1250, y: 30, vx: 0, vy: 0, spin: 0 });
      // Drive ball 0 out the right goal.
      await api.call("setBall", 0, {
        x: 1100,
        y: 360,
        vx: 900,
        vy: 0,
        spin: 0,
      });
    },

    async act(api) {
      // Run until ball 0 has scored and respawned (it is held at its home again).
      // 180 ticks = the old 1.5 s cap. The old chunk was 0.02 s = 2.4 ticks, which is
      // not a whole tick: poll 2 rather than 3, because a finer sweep can only sharpen
      // the instant the respawn is caught, never miss one a coarser sweep would find.
      const r = await api.until((s) => s.balls[0].held, { max: 180, poll: 2 });
      snap = r.snap;
      // Stay on the respawn so the clip shows ball 0's countdown running out and
      // serving again while the other two sit untouched — the per-ball respawn the
      // assertions below score.
      await api.advance(192); // 192 ticks = the old 1600ms clip hold
    },

    async assert(api, check) {
      const balls = snap.balls;
      check.expectOk(
        "the ball that left the field respawns on its own (held at its home)",
        balls[0].held,
      );
      check.expectClose(
        "the respawned ball sits back on the centerline (x)",
        balls[0].x,
        640,
        2,
      );
      check.expectOk(
        "ball 1 keeps playing — it did not respawn",
        !balls[1].held,
      );
      check.expectOk(
        "ball 2 keeps playing — it did not respawn",
        !balls[2].held,
      );
      check.expectEq("only the crossing ball scored (p1)", snap.score.p1, 1);
      check.expectEq("player two did not score (p2)", snap.score.p2, 0);
    },
  };
}
