---
title: Diagnostics
---

Register a diagnostic source for every value a reviewer or a validation script
needs to see. A source is a function returning the value, and the engine calls
it whenever the overlay draws or a driver reads.

```ts
engine.diagnostics.register("score", () => `${left} - ${right}`);
engine.diagnostics.register("phase", () => phase);
engine.diagnostics.register("ball", () => ({ x: ball.x, y: ball.y }));
engine.diagnostics.register("balls", () => balls.length);
```

## Register during setup

Register sources once, after `createEngine` and before `engine.frame.run`. The
sources close over the game's state, so they keep reporting correctly as that
state changes and never need re-registering.

```ts
const engine = createEngine({ canvas, width: 640, height: 360 });

const world = {
  phase: "serve" as "serve" | "rally" | "over",
  ball: { x: 320, y: 180, vx: 180, vy: 90 },
  score: { left: 0, right: 0 },
};

engine.diagnostics.register("phase", () => world.phase);
engine.diagnostics.register("score", () => `${world.score.left} - ${world.score.right}`);
engine.diagnostics.register("ball", () => ({ x: world.ball.x, y: world.ball.y }));
engine.diagnostics.register("speed", () => Math.hypot(world.ball.vx, world.ball.vy));
engine.diagnostics.register("fps", () => 1000 / engine.frame.info().lastDeltaMs);

engine.frame.run({
  update(dt) { step(world, dt); },
  render(ctx) { draw(ctx, world); },
});
```

## What makes a good source

A source reads and returns; it leaves the game's state exactly as it found it.
It runs on every frame the overlay is visible, so it stays cheap: read a field,
compute one number, build a small object.

Name the values a check would otherwise have to infer from pixels. A score, the
current phase, the number of live entities, and the position of the object under
test each turn a screenshot comparison into a direct assertion. Values the
simulation already holds are the best candidates, since a diagnostic deriving
something the game never computed is a second implementation that can disagree
with the first.

Keep each value to about a line. Return a string when the presentation matters,
a number when a driver will compare it, and a small object for a pair such as a
position.

```ts
engine.diagnostics.register("hud", () => `${world.lives} lives, wave ${world.wave}`);
engine.diagnostics.register("elapsed", () => engine.frame.info().timeMs / 1000);
engine.diagnostics.register("paused", () => world.phase === "over");
```

## Showing the overlay

The engine owns the backtick key and toggles the overlay with it, so a build
needs no key handling of its own and leaves that key free of gameplay bindings.
The overlay starts hidden, which is the right default for a game a human is
about to play.

Turn it on from the game only when the build is meant to open with diagnostics
visible:

```ts
engine.diagnostics.setEnabled(true);
```

## Replacing a source

Re-registering a name replaces its source and keeps its line where it was, which
is what a source that changes shape between phases should use.

```ts
engine.diagnostics.register("target", () => world.target ?? "none");
```

A source that throws shows its message in place of its value and leaves the rest
of the panel intact, so a diagnostic guards against the state it reports being
absent rather than the game guarding the diagnostic.
