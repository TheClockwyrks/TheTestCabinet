// Automated validation for the Multi-ball sub-item `three-balls`: three balls are
// in play at once, each an independent contest with its own velocity.
//
// A seeded reset makes the random launches reproducible. After the match-start
// serve, the snapshot must report three live balls, each moving, with distinct
// velocities — three independent contests rather than one ball drawn three times.

export default async function drive(api, ttc) {
  const check = ttc.checkOne("multi-ball.three-balls");

  await api.reset({ seed: 11 });
  await api.call("startMatch", "versus");
  await api.call("serve");
  const balls = (await api.snapshot()).balls;

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
        Math.abs(b.vx - balls[0].vx) > 1 || Math.abs(b.vy - balls[0].vy) > 1,
    );
  check.expectOk(
    "the balls carry different velocities from one another",
    distinctVel,
  );

  // A clip: the three balls bouncing around the field together. Hand the clock back
  // to the animation loop so the balls actually move in the clip.
  await api.call("setAutoStep", true);
  await api.wait(2000);

  return check.verdict();
}
