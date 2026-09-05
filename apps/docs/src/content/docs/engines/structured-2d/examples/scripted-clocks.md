---
title: Scripted Clocks
---

The three scripted clocks ignore the host timestamp and supply their deltas from
a constant, a repeating list, or a seeded draw. Under `engine.advance` a frame
therefore costs exactly what the clock says and no real time is involved, so a
validator chooses the shape of time a scenario runs under.

Every example below uses the harness and the debug surface from
[Validating a Game](/engines/structured-2d/examples/validating-a-game/). The
harness takes the clock as an option and installs it at construction, and the
surface is read off `engine.debug`.

## The three clocks

| Clock | Each frame is worth |
| --- | --- |
| `ConstantClock(stepMs)` | `stepMs`, every frame |
| `SequenceClock(stepsMs)` | the next entry, repeating from the start |
| `JitterClock(minMs, maxMs, seed)` | a draw from the range, as a function of the seed and the frame index |

A seeded draw replays exactly, so two engines given the same seed take the same
deltas in the same order and a failure found under jitter can be run again.

## The deltas each clock delivers

`engine.frame().lastDeltaMs` reports the step the current frame was worth, so a
check reads the clock's own output back off the engine. The three assertions
below state the whole of what each scripted clock guarantees: one step held, a
list repeated, and a draw kept inside its range.

```ts
// validation/deltas.test.ts
import {
  ConstantClock,
  JitterClock,
  SequenceClock,
  type Clock,
} from "@clockwyrks/structured-2d";
import { expect, it } from "vitest";
import { createHarness } from "./harness";

const PATTERN = [4, 4, 4, 4, 33, 16];

async function deltas(clock: Clock, frames: number): Promise<number[]> {
  const harness = await createHarness({ clock });
  const steps: number[] = [];
  for (let i = 0; i < frames; i += 1) {
    await harness.engine.advance(1);
    steps.push(harness.engine.frame().lastDeltaMs);
  }
  harness.dispose();
  return steps;
}

it("holds one step under a constant clock", async () => {
  const stepMs = 1000 / 240;

  expect(await deltas(new ConstantClock(stepMs), 4)).toEqual([
    stepMs,
    stepMs,
    stepMs,
    stepMs,
  ]);
});

it("repeats the sequence in order", async () => {
  const steps = await deltas(new SequenceClock(PATTERN), PATTERN.length * 2);

  expect(steps).toEqual([...PATTERN, ...PATTERN]);
});

it("draws every jittered delta from its range", async () => {
  const steps = await deltas(new JitterClock(4, 40, 20260819), 200);

  expect(Math.min(...steps)).toBeGreaterThanOrEqual(4);
  expect(Math.max(...steps)).toBeLessThanOrEqual(40);
  expect(new Set(steps).size).toBeGreaterThan(1);
});
```

One cycle of the pattern is 65 milliseconds over six frames, which is how a step
six times the usual size is put in front of a build at a known frame, every run.
The jitter check states the bounds the clock guarantees and the distinct count
states that the run saw more than one step size.

## Advancing by duration

A frame count fixes a duration only under a constant step. Where the step
varies, a validator advances one frame at a time until the simulated clock
reaches the target.

```ts
// validation/advance-ms.ts
import type { Engine } from "@clockwyrks/structured-2d";

export async function advanceMs(engine: Engine, ms: number): Promise<void> {
  const target = engine.frame().timeMs + ms;
  while (engine.frame().timeMs < target) {
    await engine.advance(1);
  }
}
```

The loop overshoots the target by at most one step, which is the figure a check
allows for when it asserts against elapsed simulated time.

## Replacing the clock mid-scenario

`engine.setClock` swaps the clock in place, and the next frame takes its delta
from the new one. The frame counter and the accumulated simulated time carry
over, so posing a scenario under an exact step and then running it under jitter
is one scenario rather than two.

```ts
const harness = await createHarness({ clock: new ConstantClock(1000 / 120) });
const { engine } = harness;
engine.debug.placeRunner({ x: 120, y: 60 });
await engine.advance(60);

engine.setClock(new JitterClock(4, 40, 20260819));
harness.hold("right");
await advanceMs(engine, 2500);
```

## One scenario, three step sizes

The scenario reduces the world to two orbs, puts one 300 units down a clear lane
and the other clear of the runner's path, places the runner at the near end, and
holds the right action for two seconds of simulated time. A correct build
collects the orb once, scores it, and finishes 360 units along.

```ts
// validation/clocks.test.ts
import {
  ConstantClock,
  JitterClock,
  SequenceClock,
  type Clock,
} from "@clockwyrks/structured-2d";
import { expect, it } from "vitest";
import { advanceMs } from "./advance-ms";
import { ORB_POINTS, TAGS } from "./constants";
import { createHarness } from "./harness";

const START = { x: 120, y: 60 };
const TARGET = { x: 420, y: 60 };
const PARKED = { x: 600, y: 320 };
const TRAVEL_MS = 2000;
const MAX_STEP_MS = 40;

interface Outcome {
  frames: number;
  travelMs: number;
  collects: number;
  collectedAtMs: number;
  score: number;
  remaining: number;
  x: number;
}

async function runScenario(clock: Clock): Promise<Outcome> {
  const harness = await createHarness({ clock });
  const { engine } = harness;
  const world = harness.world();

  engine.debug.keepOrbs(2);
  await engine.advance(1);
  engine.debug.placeOrb(0, TARGET);
  engine.debug.placeOrb(1, PARKED);
  engine.debug.placeRunner(START);

  const collected: number[] = [];
  engine.events.on("cue:played", ({ cue, t }) => {
    if (cue === "collect") collected.push(t);
  });

  const startMs = engine.frame().timeMs;
  const startFrames = engine.frame().count;
  harness.hold("right");
  await advanceMs(engine, TRAVEL_MS);
  harness.release("right");

  const snapshot = engine.debug.snapshot();
  const outcome: Outcome = {
    frames: engine.frame().count - startFrames,
    travelMs: engine.frame().timeMs - startMs,
    collects: collected.length,
    collectedAtMs: (collected[0] ?? Number.NaN) - startMs,
    score: snapshot.score,
    remaining: world.byTag(TAGS.orb).length,
    x: snapshot.runner.x,
  };
  harness.dispose();
  return outcome;
}

it("reaches the same outcome under every step size", async () => {
  const clocks: Clock[] = [
    new ConstantClock(1000 / 240),
    new SequenceClock([4, 4, 4, 4, 33, 16]),
    new JitterClock(4, MAX_STEP_MS, 20260819),
  ];

  const outcomes: Outcome[] = [];
  for (const clock of clocks) {
    outcomes.push(await runScenario(clock));
  }

  for (const outcome of outcomes) {
    expect(outcome.collects).toBe(1);
    expect(outcome.score).toBe(ORB_POINTS);
    expect(outcome.remaining).toBe(1);
    expect(outcome.collectedAtMs).toBeGreaterThanOrEqual(1555);
    expect(outcome.collectedAtMs).toBeLessThan(1556 + MAX_STEP_MS);
    expect(outcome.travelMs).toBeGreaterThanOrEqual(TRAVEL_MS);
    expect(outcome.travelMs).toBeLessThan(TRAVEL_MS + MAX_STEP_MS);
    expect(Math.abs(outcome.x - 480)).toBeLessThan(10);
  }

  expect(new Set(outcomes.map((outcome) => outcome.frames)).size).toBe(3);
});

it("replays exactly under the same seed", async () => {
  const first = await runScenario(new JitterClock(4, MAX_STEP_MS, 20260819));
  const second = await runScenario(new JitterClock(4, MAX_STEP_MS, 20260819));

  expect(second).toEqual(first);
});
```

The lane is 300 units long and the runner walks it at 180 units per second. The
orb is collected once the gap between the two closes to the sum of their radii,
which is 20 units, so the ideal collection instant is 280 units of travel at
1555.6 milliseconds. Two seconds of travel put the runner 360 units along, at
`x = 480`.

The three clocks reach that outcome over roughly 480, 185, and 91 frames. The
final assertion states that the three frame counts differ, so the check is known
to have run at three step sizes rather than three times at one.

## What survives a change in step size

These are the figures a validator asserts on, because a build that integrates
against the delta it is given produces them whatever the clock delivered.

| Figure | Why it holds |
| --- | --- |
| The event count | One overlap begins once, whichever frame finds it |
| The score and the orbs left | Both follow from the event count |
| The order of events | The frame order is fixed, so a collection precedes what it caused |
| Elapsed simulated time | `advanceMs` stops at the target, overshooting by at most one step |
| A position, as a band | The travel is the same, and the band absorbs one step of it |

A position compared for equality across two step sizes is a check of the step
size rather than of the build. The band is one step of travel at the widest step
the run allows, which is `MAX_STEP_MS` at the walking speed, or 7.2 units. The
check allows 10.

## What legitimately diverges

Two correct runs of one scenario differ in ways a validator has to leave room
for.

The frame count differs, and with it every figure derived from it. Nothing the
specification fixes is stated in frames, so a check states a duration and
converts it through the clock rather than asserting a count.

The final position differs by up to one step of travel at either end. The last
frame overshoots the target duration, and the frame that crossed a threshold did
so from a different distance away.

An event's timestamp differs by up to one step. An overlap is found on the first
frame the two shapes are inside each other, and a larger step arrives at that
state later and deeper. A check therefore asserts the count exactly and the
instant as a band.

The manifold depth differs. A blocking pair is separated by however far this
frame's movement drove it in, so a larger step produces a deeper penetration and
a stronger correction. A check reads the normal, which is a direction, rather
than the depth, which is a step size.

Accumulated floating-point error differs. A thousand additions of 4.17
milliseconds and a hundred additions of 22 do not land on the same value, so a
check of simulated time uses `toBeCloseTo` rather than `toBe`.

What does not differ is the outcome of a scenario run twice under the same
clock. Each scripted clock is fully determined, so the whole run is, and two
`JitterClock` instances built from one seed produce identical outcome objects.
