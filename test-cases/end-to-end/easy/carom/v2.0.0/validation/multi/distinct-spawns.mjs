// Automated validation for the Multi-ball sub-item `distinct-spawns`: each ball has
// its own centerline home point rather than sharing one spawn.
//
// At the match-start countdown (before the serve) every ball sits held at its home
// point. The snapshot must show all three on the centerline (x ~ 640) at three
// distinct heights, so they spawn from their own points rather than one shared spot.

export default function item() {
  // The held balls `act` read back, for `assert` to score.
  let balls;

  return {
    id: "multi-ball.distinct-spawns",

    // Start the match but do NOT serve: the balls sit held at their home points.
    async arrange(api) {
      await api.reset({ seed: 3 });
      await api.call("startMatch", "versus");
    },

    // Read the held spawns, then let the countdown run on a little — still well short
    // of the serve — so the still captures the three balls waiting at their own home
    // points rather than a frame the countdown had not painted yet.
    async act(api) {
      balls = (await api.snapshot()).balls;
      await api.advance(60); // 60 ticks (0.5 s) of countdown, far short of the serve
      // A still: the three balls waiting at their distinct home points.
      await api.screenshot("spawns");
    },

    async assert(api, check) {
      check.expectEq(
        "three balls wait at their spawn points during the countdown",
        balls.length,
        3,
      );
      check.expectOk(
        "every ball waits held at its spawn point during the countdown",
        balls.every((b) => b.held),
      );
      check.expectOk(
        "every spawn sits on the centerline (x ~ 640)",
        balls.every((b) => Math.abs(b.x - 640) < 2),
      );
      // Distinct home points: the three spawn heights are all clearly different.
      const ys = balls.map((b) => b.y).sort((a, b) => a - b);
      check.expectGt(
        "the lowest two spawn heights are distinct (Δy)",
        ys[1] - ys[0],
        40,
      );
      check.expectGt(
        "the top two spawn heights are distinct (Δy)",
        ys[2] - ys[1],
        40,
      );
    },
  };
}
