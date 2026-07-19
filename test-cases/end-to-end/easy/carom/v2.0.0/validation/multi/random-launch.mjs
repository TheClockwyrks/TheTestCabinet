// Automated validation for the Multi-ball sub-item `random-launch`: each ball
// launches in a random direction over the full circle rather than a fixed serve.
//
// Launches run off a seedable generator (specs/instrumentation.md), so the same
// seed replays identical angles — checked directly. And across seeds the launch
// directions span the whole circle (steep and shallow, left and right), which a
// fixed near-horizontal serve could never do.

// The launch state of all three balls right after a seeded match-start serve.
async function launch(api, seed) {
  await api.reset({ seed });
  await api.call("startMatch", "versus");
  await api.call("serve");
  return (await api.snapshot()).balls.map((b) => ({
    angle: Math.atan2(b.vy, b.vx),
    vx: b.vx,
    vyFrac: b.speed > 0 ? Math.abs(b.vy) / b.speed : 0,
  }));
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("multi-ball.random-launch");

  // Reproducibility: the same seed replays the same launch angles.
  const a = await launch(api, 42);
  const b = await launch(api, 42);
  const reproducible =
    a.length === 3 && a.every((l, i) => Math.abs(l.angle - b[i].angle) < 1e-9);
  check.expectOk(
    "the same seed replays identical launch angles (seeded)",
    reproducible,
  );

  // Variety: gather every launch across several seeds and confirm the directions
  // span the full circle — some steeply vertical, and launches to both sides.
  const all = [];
  for (const seed of [1, 2, 3, 4, 5]) all.push(...(await launch(api, seed)));
  const maxVyFrac = Math.max(...all.map((l) => l.vyFrac));
  const bothSides = all.some((l) => l.vx > 0) && all.some((l) => l.vx < 0);
  check.expectGt(
    "some launches are steeply vertical, impossible for a fixed serve (max |vy|/speed)",
    maxVyFrac,
    0.5,
  );
  check.expectOk(
    "launches go to both sides of the field (full 360deg range)",
    bothSides,
  );

  // A clip: a fresh serve firing the three balls off in their own directions.
  await api.reset({ seed: 9 });
  await api.call("startMatch", "versus");
  await api.call("serve");
  await api.call("setAutoStep", true); // hand the clock back so the clip animates
  await api.wait(1400);

  return check.verdict();
}
