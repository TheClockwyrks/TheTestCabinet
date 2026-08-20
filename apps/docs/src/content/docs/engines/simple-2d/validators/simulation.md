---
title: Simulation
---

A check advances the game a known amount of simulated time and reads the state
back. The [clock](/engines/simple-2d/apis/clocks/) decides what each frame is
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
import { ConstantClock } from "@test-cabinet/simple-2d";
import { setBall, startMatch } from "../../src/debug";
import { createHarness } from "../harness";

it("a ball leaving the right edge scores for player one", async () => {
  const { engine } = createHarness(new ConstantClock(1000 / 60));
  const state = await engine.initialize();

  startMatch(state, "versus");
  setBall(state, { x: FIELD_W - 40, y: FIELD_H / 2, vx: 600, vy: 0 });
  await engine.advance(30);

  expect(state.scoreP1).toBe(1);
  expect(state.screen).toBe("countdown");
});
```

The scenario is posed through the case's `debug.ts` operations, which write the
game's own state and leave the outcome to the frames that follow. What the
assertions read is what the real update produced.

## Reading the state

`engine.initialize` resolves to the game's state and `engine.state` is the same
value, live. A read after an `advance` therefore sees that frame's values, and a
value that must survive later frames is copied at the moment it is read.

```ts
const startY = state.ball.y;
await engine.advance(60);
expect(state.ball.y).not.toBe(startY);
```

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
  const state = await engine.initialize();

  startMatch(state, "versus");
  setBall(state, { x: FIELD_W - 40, y: FIELD_H / 2, vx: 600, vy: 0 });
  await advanceMs(engine, 500);

  expect(state.scoreP1).toBe(1);
}
```

Each clock delivers a different number of frames for the same simulated
duration, so the scenario is driven to a duration rather than to a frame count.

## What to assert on

Assert on outcomes that survive a legitimate change in step size: whether an
event occurred, which side scored, which screen the game is showing, and the
state the result left behind. Numerical integration of a nonlinear system
diverges across step sizes while every step of it stays correct, so two correct
runs reach different positions and velocities.

Where a check is genuinely about a quantity, state it as a tolerance wide enough
for the step sizes under test, or fix the step size for that check alone with a
`ConstantClock`. A single-clock check states a claim about one cadence, and the
claim about delta-time independence is the loop above.
