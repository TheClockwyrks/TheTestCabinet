// Automated validation for the Multi-ball sub-item `three-balls`: three balls are
// in play at once, each an independent contest with its own velocity.
//
// A seeded reset makes the random launches reproducible. After the match-start
// serve, the snapshot must report three live balls, each moving, with distinct
// velocities — three independent contests rather than one ball drawn three times.

export default function item() {
  // The launched balls `act` read back, for `assert` to score.
  let balls;

  return {
    id: "multi-ball.three-balls",

    // A seeded reset, so the random launches this reads back are reproducible.
    async arrange(api) {
      await api.reset({ seed: 11 });
      await api.call("startMatch", "versus");
      await api.call("serve");
    },

    // Read the three launches, then let them play so the clip shows the balls
    // bouncing around the field together — three contests running at once.
    async act(api) {
      balls = (await api.snapshot()).balls;
      await api.advance(240); // 240 ticks = the old 2000ms clip hold
    },

    async assert(api, check) {
      check.expectEq("three balls are in play at once", balls.length, 3);
      check.expectOk(
        "every ball is live (none held) with its own velocity",
        balls.every((b) => !b.held && b.speed > 1),
      );
      // Independent contests: the three velocity vectors are not all the same.
      const distinctVel =
        balls.length === 3 &&
        balls.some(
          (b) =>
            Math.abs(b.vx - balls[0].vx) > 1 ||
            Math.abs(b.vy - balls[0].vy) > 1,
        );
      check.expectOk(
        "the balls carry different velocities from one another",
        distinctVel,
      );
    },
  };
}
