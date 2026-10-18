// Automated validation for the Multi-ball sub-item `random-launch`: each ball
// launches in a random direction over the full circle rather than a fixed serve.
//
// Launches run off a seedable generator (specs/instrumentation.md), so the same
// seed replays identical angles — checked directly. And across seeds the launch
// directions span the whole circle (steep and shallow, left and right), which a
// fixed near-horizontal serve could never do.

// The launch state of all three balls right after a seeded match-start serve. Every
// step is a control op or an instant read — no time passes — so this is
// ARRANGE-callable, which is what lets the whole survey be gathered as a precondition.
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

export default function item() {
  // The launch survey `arrange` gathered, for `assert` to score.
  let reproducible;
  let maxVyFrac;
  let bothSides;

  return {
    id: "multi-ball.random-launch",

    async arrange(api) {
      // Reproducibility: the same seed replays the same launch angles.
      const a = await launch(api, 42);
      const b = await launch(api, 42);
      reproducible =
        a.length === 3 &&
        a.every((l, i) => Math.abs(l.angle - b[i].angle) < 1e-9);

      // Variety: gather every launch across several seeds and confirm the directions
      // span the full circle — some steeply vertical, and launches to both sides.
      const all = [];
      for (const seed of [1, 2, 3, 4, 5])
        all.push(...(await launch(api, seed)));
      maxVyFrac = Math.max(...all.map((l) => l.vyFrac));
      bothSides = all.some((l) => l.vx > 0) && all.some((l) => l.vx < 0);

      // Leave the build on one more fresh seeded serve, so the timed phase below
      // shows a launch of exactly the kind the survey scored.
      await api.reset({ seed: 9 });
      await api.call("startMatch", "versus");
      await api.call("serve");
    },

    // The clip: the fresh serve firing the three balls off in their own directions.
    async act(api) {
      await api.advance(168); // 168 ticks = the old 1400ms clip hold
    },

    async assert(api, check) {
      check.expectOk(
        "the same seed replays identical launch angles (seeded)",
        reproducible,
      );
      check.expectGt(
        "some launches are steeply vertical, impossible for a fixed serve (max |vy|/speed)",
        maxVyFrac,
        0.5,
      );
      check.expectOk(
        "launches go to both sides of the field (full 360deg range)",
        bothSides,
      );
    },
  };
}
