---
title: Simulation
---

A check advances the game a known amount of simulated time and reads the world
back. The [clock](/engines/structured-3d/apis/clocks/) decides what each frame
is worth and `engine.advance` decides how many frames run, so both halves of
"how much time passed" belong to the suite.

## Stepping

`engine.advance(frames)` ticks the clock exactly that many times back to back
and resolves. No host frame callback separates the ticks and no real time
passes, so a check waits on nothing and polls nothing. A tick the clock declines
runs no frame, and a level transition requested during a frame completes before
the next frame begins, because `advance` awaits it.

Pair it with a clock that supplies its own deltas. A `ConstantClock` is the
usual choice: sixty frames of `new ConstantClock(1000 / 60)` is one second of
simulated time, whatever the machine running the suite is doing.

```ts
import { ConstantClock } from "@test-cabinet/structured-3d";
import { GOAL_X, TAGS } from "../../src/constants";
import { createHarness } from "../harness";

it("a ball leaving the far goal plane scores for player one", async () => {
  const { engine } = createHarness(new ConstantClock(1000 / 60));
  await engine.initialize();
  const world = engine.world;

  engine.debug.startMatch("versus");
  engine.debug.setBallPosition(GOAL_X - 1, 0, 0);
  engine.debug.setBallVelocity(20, 0, 0);
  await engine.advance(30);

  expect(world.state.players[0].score).toBe(1);
  expect(world.state.phase).toBe("playing");
});
```

The scenario is posed through the operations of the build's debug surface, read
off `engine.debug`. Each pose is a method that acts on the world the engine
holds: it spawns actors, moves transforms, and drives the game mode through the
same surfaces play uses, and leaves the outcome to the frames that follow. What
the assertions read is what the real frame produced.

## Reading the world back

`engine.world` is the world currently open, live, and `engine.instance` is the
game instance. A read after an `advance` therefore sees that frame's values, and
a value that must survive later frames is copied at the moment it is read. A
transform's `position` is a mutable record a build may write in place, so the
copy is of the record rather than of the reference.

```ts
const ball = world.byTag(TAGS.ball)[0];
const start = { ...ball.transform.position };
await engine.advance(60);
expect(ball.transform.position.x).not.toBe(start.x);
```

A transition rebuilds the world, so a check that opens a new level re-reads
`engine.world` afterwards rather than holding the object it had. The instance
and the frame counter cross the transition; `world.time` restarts at zero.

`engine.frame()` reports the frame count, the accumulated simulated time in
milliseconds, and the delta the last frame was stepped by. It is how a check
states a duration in time rather than in frames.

```ts
async function advanceMs(engine: Engine, ms: number): Promise<void> {
  const until = engine.frame().timeMs + ms;
  while (engine.frame().timeMs < until) await engine.advance(1);
}
```

A throw inside a tick or a draw rejects the `advance` that was running, and the
frames after it are abandoned. The failure surfaces at the step that caused it
with the build's own stack behind it.

## Changing the step size

A build integrates against the delta it is given rather than against a count of
frames, and running one scenario under several clocks is what establishes it.
`ConstantClock`, `SequenceClock`, and `JitterClock` cover the ground between
them: an even step, a repeating uneven pattern, and a seeded draw that replays
exactly when it fails.

```ts
const clocks = [
  new ConstantClock(1000 / 60),
  new SequenceClock([8, 33, 12, 21]),
  new JitterClock(8, 40, 7),
];

for (const clock of clocks) {
  const { engine } = createHarness(clock);
  await engine.initialize();
  const world = engine.world;

  engine.debug.startMatch("versus");
  engine.debug.setBallPosition(GOAL_X - 1, 0, 0);
  engine.debug.setBallVelocity(20, 0, 0);
  await advanceMs(engine, 500);

  expect(world.state.players[0].score).toBe(1);
  engine.destroy();
}
```

Each clock delivers a different number of frames for the same simulated
duration, so the scenario is driven to a duration rather than to a frame count.
Every `tick(dt)` the framework calls receives seconds, and the clock's deltas
are milliseconds, which is the one conversion a check states in either unit.

## What to assert on

Assert on outcomes that survive a legitimate change in step size: whether an
event occurred, which side scored, which level is open, the match phase, and the
state the result left behind. Numerical integration of a nonlinear system
diverges across step sizes while every step of it stays correct, so two correct
runs reach different positions, rotations, and velocities.

Where a check is genuinely about a quantity, state it as a tolerance wide enough
for the step sizes under test, or fix the step size for that check alone with a
`ConstantClock`. A single-clock check states a claim about one cadence, and the
claim about delta-time independence is the loop above. A claim about a position
is stated per component, or as a `distance` from a known point, and a claim
about an orientation as the direction `quatRotate` turns `FORWARD` into,
because a quaternion and its negation are one rotation and compare unequal
field by field.

`world.time` accumulates every frame the world is stepped by, and
`world.state.elapsed` accumulates only while the phase is `"playing"`, so a
claim about the match clock reads the second and a claim about the world's own
time reads the first.
