// Automated validation for the Multi-ball sub-item `distinct-spawns`: each ball has
// its own centerline home point rather than sharing one spawn.
//
// At the match-start countdown (before the serve) every ball sits held at its home
// point. The snapshot must show all three on the centerline (x ~ 640) at three
// distinct heights, so they spawn from their own points rather than one shared spot.

import { asserter } from "../_helpers.mjs";

export default async function drive(api) {
  const rec = asserter();

  await api.reset({ seed: 3 });
  // Start the match but do NOT serve: the balls sit held at their home points.
  await api.call("startMatch", "versus");
  const balls = (await api.snapshot()).balls;

  rec.check(
    "three balls wait at their spawn points during the countdown",
    balls.length === 3 && balls.every((b) => b.held),
  );
  rec.check(
    `every spawn sits on the centerline (x ~ 640: ${balls.map((b) => b.x.toFixed(0)).join(", ")})`,
    balls.length === 3 && balls.every((b) => Math.abs(b.x - 640) < 2),
  );
  // Distinct home points: the three spawn heights are all clearly different.
  const ys = balls.map((b) => b.y).sort((a, b) => a - b);
  const distinct = ys.length === 3 && ys[1] - ys[0] > 40 && ys[2] - ys[1] > 40;
  rec.check(
    `the three spawn heights are distinct (y = ${ys.map((y) => y.toFixed(0)).join(", ")})`,
    distinct,
  );

  // A still: the three balls waiting at their distinct home points.
  await api.screenshot("spawns");

  return { verdicts: { "multi-ball.distinct-spawns": rec.assertions } };
}
