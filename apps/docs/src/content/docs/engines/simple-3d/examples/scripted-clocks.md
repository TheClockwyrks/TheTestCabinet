---
title: Scripted Clocks
---

The three scripted clocks ignore the host timestamp and supply their deltas from
a constant, a repeating list, or a seeded draw. Under `engine.advance` a frame
therefore costs exactly what the clock says and no real time is involved, so a
validator chooses the shape of time the scenario runs under.

Every example on this page uses the harness from
[Validating a Game](/engines/simple-3d/examples/validating-a-game/), which
accepts the clock as an option and installs it at construction, poses the ball
through `engine.apply`, and reads a snapshot off `engine.state`.

## Exact stepping with `ConstantClock`

A constant step turns a duration into a frame count, so the value a check
asserts is the value the specification states.

```ts
// validation/constant.test.ts
import { ConstantClock } from "@test-cabinet/simple-3d";
import { expect, it } from "vitest";
import { createHarness } from "./harness";

const framesFor = (ms: number, stepMs: number): number => Math.round(ms / stepMs);

it("advances simulated time by the step it was given", async () => {
  const stepMs = 1000 / 240;
  const harness = await createHarness({ clock: new ConstantClock(stepMs) });
  const { engine } = harness;
  harness.setBall({
    position: { x: 0, y: 0.5, z: 0 },
    velocity: { x: 4, y: 0, z: 0 },
  });

  await engine.advance(framesFor(1500, stepMs));

  expect(engine.frame().count).toBe(360);
  expect(engine.frame().timeMs).toBeCloseTo(1500, 6);
  expect(engine.frame().lastDeltaMs).toBeCloseTo(stepMs, 9);
  expect(harness.snapshot().ball.position.x).toBeCloseTo(6, 3);

  harness.dispose();
});
```

One and a half seconds at 240 frames per second is 360 frames, and the ball
covers 6 world units, stopping short of the reflection point its edge meets at
7.5. Choosing 240 runs the scenario at a step no display delivers, which is
what selecting the clock buys over inheriting one.

## A repeating pattern with `SequenceClock`

A sequence delivers its entries in order and repeats, which is how an uneven but
reproducible frame pattern is expressed. This one is four fast frames, a 33
millisecond stutter, and a 16 millisecond recovery.

```ts
// validation/sequence.test.ts
import { SequenceClock } from "@test-cabinet/simple-3d";
import { expect, it } from "vitest";
import { BALL_RADIUS, WALL_X, createHarness } from "./harness";

const PATTERN = [4, 4, 4, 4, 33, 16];

it("delivers the pattern in order and repeats it", async () => {
  const harness = await createHarness({ clock: new SequenceClock(PATTERN) });
  const { engine } = harness;

  const deltas: number[] = [];
  for (let i = 0; i < PATTERN.length * 2; i += 1) {
    await engine.advance(1);
    deltas.push(engine.frame().lastDeltaMs);
  }

  expect(deltas).toEqual([...PATTERN, ...PATTERN]);
  expect(engine.frame().timeMs).toBeCloseTo(130, 6);

  harness.dispose();
});

it("keeps the ball inside the court across a stutter", async () => {
  const harness = await createHarness({ clock: new SequenceClock(PATTERN) });
  const { engine } = harness;
  harness.setBall({
    position: { x: 6.9, y: 0.5, z: 0 },
    velocity: { x: 4, y: 0, z: 0 },
  });

  await engine.advance(PATTERN.length * 4);

  const { ball } = harness.snapshot();
  expect(ball.velocity.x).toBe(-4);
  expect(ball.position.x).toBeLessThanOrEqual(WALL_X - BALL_RADIUS);

  harness.dispose();
});
```

One cycle is 65 milliseconds, so two cycles put the simulated clock at 130. The
second check starts the ball 0.6 units from the reflection point, so the
reflection is due 150 milliseconds in, inside the third cycle's 33 millisecond
frame, and the check reads whether the build's collision response survives a
step eight times its usual size.

## A seeded draw with `JitterClock`

A jitter clock draws each delta from its range as a function of the seed and the
frame index, so one seed replays exactly. Two engines given the same seed reach
the same state, and a failure found under jitter is a failure that can be run
again.

```ts
// validation/jitter.test.ts
import { JitterClock, type Clock } from "@test-cabinet/simple-3d";
import { expect, it } from "vitest";
import { createHarness } from "./harness";

interface Sampled {
  readonly x: number;
  readonly deltas: readonly number[];
}

async function runFor(clock: Clock, frames: number): Promise<Sampled> {
  const harness = await createHarness({ clock });
  const { engine } = harness;
  harness.setBall({
    position: { x: 0, y: 0.5, z: 0 },
    velocity: { x: 4, y: 0, z: 0 },
  });

  const deltas: number[] = [];
  for (let i = 0; i < frames; i += 1) {
    await engine.advance(1);
    deltas.push(engine.frame().lastDeltaMs);
  }

  const x = harness.snapshot().ball.position.x;
  harness.dispose();
  return { x, deltas };
}

it("replays exactly under the same seed", async () => {
  const first = await runFor(new JitterClock(4, 40, 20260819), 200);
  const second = await runFor(new JitterClock(4, 40, 20260819), 200);

  expect(second.deltas).toEqual(first.deltas);
  expect(second.x).toBe(first.x);
});

it("draws every delta from its range", async () => {
  const { deltas } = await runFor(new JitterClock(4, 40, 20260819), 200);

  expect(Math.min(...deltas)).toBeGreaterThanOrEqual(4);
  expect(Math.max(...deltas)).toBeLessThanOrEqual(40);
  expect(new Set(deltas).size).toBeGreaterThan(1);
});
```

Comparing the two runs for exact equality is available because the whole
scenario is deterministic: the same deltas in the same order produce the same
arithmetic. The bounds check states what the clock guarantees, and the distinct
count states that the run saw more than one step size.

## Advancing by duration

A frame count fixes a duration only under a constant step. Where the step
varies, a validator advances one frame at a time until the simulated clock
reaches the target.

```ts
// validation/advance-ms.ts
import type { Engine } from "@test-cabinet/simple-3d";
import type { State } from "../src/game";

export async function advanceMs(engine: Engine<State>, ms: number): Promise<void> {
  const target = engine.frame().timeMs + ms;
  while (engine.frame().timeMs < target) {
    await engine.advance(1);
  }
}
```

The loop overshoots the target by at most one step, which is the figure a check
allows for when it asserts against elapsed simulated time.

## Replacing the clock mid-scenario

`engine.setClock` swaps the clock in place, and the frame counter and the
accumulated time carry over. Posing a scenario under an exact step and then
running it under jitter is one scenario rather than two.

```ts
const harness = await createHarness({ clock: new ConstantClock(1000 / 120) });
const { engine } = harness;
harness.setBall({
  position: { x: 0, y: 0.5, z: 0 },
  velocity: { x: 4, y: 0, z: 0 },
});
await engine.advance(60);

engine.setClock(new JitterClock(4, 40, 20260819));
await advanceMs(engine, 2500);
```

## Delta-time independence

Running one posed scenario under all three clocks is how a build is shown to
integrate against the delta it is given rather than against a count of frames.
The check compares the outcomes that survive a change in step size.

```ts
// validation/delta-independence.test.ts
import {
  ConstantClock,
  JitterClock,
  SequenceClock,
  type Clock,
} from "@test-cabinet/simple-3d";
import { expect, it } from "vitest";
import { BALL_RADIUS, WALL_X, createHarness } from "./harness";
import { advanceMs } from "./advance-ms";

interface Outcome {
  readonly bounces: number;
  readonly vx: number;
  readonly x: number;
  readonly elapsedMs: number;
}

async function runScenario(clock: Clock): Promise<Outcome> {
  const harness = await createHarness({ clock });
  const { engine } = harness;

  const played: string[] = [];
  engine.events.on("cue:played", ({ cue }) => {
    played.push(cue);
  });

  harness.setBall({
    position: { x: 0, y: 0.5, z: 0 },
    velocity: { x: 4, y: 0, z: 0 },
  });
  await advanceMs(engine, 3000);

  const { ball } = harness.snapshot();
  const outcome: Outcome = {
    bounces: played.filter((cue) => cue === "bounce").length,
    vx: ball.velocity.x,
    x: ball.position.x,
    elapsedMs: engine.frame().timeMs,
  };
  harness.dispose();
  return outcome;
}

it("reaches the same outcome under every step size", async () => {
  const clocks: Clock[] = [
    new ConstantClock(1000 / 240),
    new SequenceClock([4, 4, 4, 4, 33, 16]),
    new JitterClock(4, 40, 20260819),
  ];

  const outcomes: Outcome[] = [];
  for (const clock of clocks) {
    outcomes.push(await runScenario(clock));
  }

  for (const outcome of outcomes) {
    expect(outcome.bounces).toBe(1);
    expect(outcome.vx).toBe(-4);
    expect(Math.abs(outcome.x)).toBeLessThanOrEqual(WALL_X - BALL_RADIUS);
    expect(Math.abs(outcome.x - 3)).toBeLessThan(0.4);
    expect(outcome.elapsedMs).toBeGreaterThanOrEqual(3000);
    expect(outcome.elapsedMs).toBeLessThan(3040);
  }
});
```

The ball covers 12 world units in three seconds, reflecting once at 1875
milliseconds, so a correct build ends 3 units from the center with its
horizontal velocity turned over whatever the step size was. The event count,
the sign of the velocity, and the elapsed simulated time are the outcomes that
survive the change.

The position is compared as a band rather than for equality. A reflection lands
at a different sub-step instant under each clock, and the final frame overshoots
the target by up to one step, so two correct runs legitimately differ by
roughly one step of travel at either end: 40 milliseconds at 4 units per second
is 0.16 units.
