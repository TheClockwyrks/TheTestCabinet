---
title: Simulation
---

A check advances the game a known amount of simulated time and reads the state
back. The [clock](/engines/simple-3d/apis/clocks/) decides what each frame is
worth and `engine.advance` decides how many frames run, so both halves of "how
much time passed" belong to the suite.

## Stepping

`engine.advance(frames)` runs exactly that many frames back to back and
resolves. No host frame callback separates them and no real time passes, so a
check waits on nothing and polls nothing.

Pair it with a clock that supplies its own deltas. A `ConstantClock` is the
usual choice: sixty frames of `new ConstantClock(1000 / 60)` is one second of
simulated time, whatever the machine running the suite is doing.

```ts
import { ConstantClock } from "@clockwyrks/simple-3d";
import { BED_Y, TRUCK_X, TRUCK_Z } from "../src/constants";
import { createHarness } from "../harness";

it("a crate lowered onto the truck bed scores", async () => {
  const { engine } = createHarness(new ConstantClock(1000 / 60));
  await engine.initialize();

  engine.apply((s) => engine.debug.setMode(s, "timed"));
  engine.apply((s) => engine.debug.setScreen(s, "playing"));
  engine.apply((s) =>
    engine.debug.setHookPosition(s, TRUCK_X, BED_Y + 4, TRUCK_Z),
  );
  engine.apply((s) => engine.debug.setHeldCrate(s, 3));
  engine.apply((s) => engine.debug.setHookVelocity(s, 0, -4, 0));
  await engine.advance(90);

  const snapshot = engine.debug.snapshot(engine.state);
  expect(snapshot.score).toBe(1);
  expect(snapshot.held).toBeNull();
});
```

The scenario is posed through the operations of the build's debug surface, read
off `engine.debug`. Each pose takes the current state and returns the next, so
a check hands it to `engine.apply`, which replaces the state with what the pose
returned and leaves the outcome to the frames that follow. What the assertions
read is what the real update produced.

Each operation sets one element of the world, so the sequence that opens a
shift is written once in the harness and every check that needs one calls it.

A harness wraps the two routes so a check names the operation alone:
`h.setMode("timed")` for
`engine.apply((s) => engine.debug.setMode(s, "timed"))`, and `h.snapshot()`
for `engine.debug.snapshot(engine.state)`.

## Reading the state

`engine.state` is the value the most recent frame or `apply` left, as a
read-only view. A read after an `advance` sees that frame's value, and a value
read before the advance stays what it was, so a before-and-after comparison is
two reads.

```ts
const startY = engine.state.hook.y;
await engine.advance(60);
expect(engine.state.hook.y).not.toBe(startY);
```

The value `engine.initialize` resolves to is the opening state and stays so
however many frames run.

`engine.frame()` reports the frame count, the accumulated simulated time in
milliseconds, and the delta the last frame was stepped by. It is how a check
states a duration in time rather than in frames.

```ts
async function advanceMs(engine: Engine<State>, ms: number): Promise<void> {
  const until = engine.frame().timeMs + ms;
  while (engine.frame().timeMs < until) await engine.advance(1);
}
```

A throw inside the game's `update` or `render` rejects the `advance` that was
running, and the frames after it are abandoned. The failure surfaces at the step
that caused it with the game's own stack behind it.

The state carries the simulation alone, so what a check reads here is the world
as the game computes it. Where an object the
build placed in the scene stands, and whether it agrees with the state, is a
[rendering](/engines/simple-3d/validators/rendering/) check.

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
  const h = createHarness(clock);
  await h.engine.initialize();

  startShift(h, "timed");
  h.setHookPosition(TRUCK_X, BED_Y + 4, TRUCK_Z);
  h.setHeldCrate(3);
  h.setHookVelocity(0, -4, 0);
  await advanceMs(h.engine, 1500);

  expect(h.snapshot().score).toBe(1);
}
```

Each clock delivers a different number of frames for the same simulated
duration, so the scenario is driven to a duration rather than to a frame count.

## What to assert on

Assert on outcomes that survive a legitimate change in step size: whether an
event occurred, whether a crate was delivered, which screen the game is
showing, and the state the result left behind. Numerical integration of a
nonlinear system diverges across step sizes while every step of it stays
correct, so two correct runs reach different positions and velocities.

Where a check is genuinely about a quantity, state it as a tolerance wide enough
for the step sizes under test, or fix the step size for that check alone with a
`ConstantClock`. A single-clock check states a claim about one cadence, and the
claim about delta-time independence is the loop above.
