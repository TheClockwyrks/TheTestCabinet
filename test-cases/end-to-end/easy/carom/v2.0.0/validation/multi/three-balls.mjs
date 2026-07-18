// Automated validation for the Multi-ball sub-item `three-balls`: three balls are
// in play at once, each an independent contest with its own velocity.
//
// A seeded reset makes the random launches reproducible. After the match-start
// serve, the snapshot must report three live balls, each moving, with distinct
// velocities — three independent contests rather than one ball drawn three times.

import { asserter } from "../_helpers.mjs";

export default async function drive(api) {
  const rec = asserter();

  await api.reset({ seed: 11 });
  await api.call("startMatch", "versus");
  await api.call("serve");
  const balls = (await api.snapshot()).balls;

  rec.check(
    `three balls are in play at once (${balls.length})`,
    balls.length === 3,
  );
  rec.check(
    "every ball is live (none held) with its own velocity",
    balls.length === 3 && balls.every((b) => !b.held && b.speed > 1),
  );
  // Independent contests: the three velocity vectors are not all the same.
  const distinctVel =
    balls.length === 3 &&
    balls.some(
      (b) =>
        Math.abs(b.vx - balls[0].vx) > 1 || Math.abs(b.vy - balls[0].vy) > 1,
    );
  rec.check(
    "the balls carry different velocities from one another",
    distinctVel,
  );

  // A clip: the three balls bouncing around the field together.
  await api.wait(2000);

  return { verdicts: { "multi-ball.three-balls": rec.assertions } };
}
