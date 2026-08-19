---
title: Driving the Clock
---

The engine's frame clock is the seam a validation script drives time through.
Taking it makes a scenario exact: frames run when the script asks for them, each
by a delta the script chose, and no real time passes.

The operations live on the
[host interface](/engines/simple-2d/validators/the-host/), so a driver reaches
them through the `hostCall` helper defined there rather than through the case's
own debug API.

## Taking the clock and stepping it

```js
await hostCall(api, "setClock", "manual");
await hostCall(api, "advance", 240);
const { count, timeMs, lastDeltaMs } = await hostCall(api, "frame");
```

`advance` runs exactly the number of frames asked for, synchronously, and
returns once they have run. There is nothing to wait on and nothing to poll, so
a check reads the same result on a fast workstation and a loaded CI runner.
`advance` requires the manual clock and throws under the auto clock.

Handing the clock back with `setClock("auto")` returns the build to the wall
clock. The frame the build runs next starts from no baseline, so the game is not
charged for the real time that elapsed while the script was stepping.

## Installing a schedule

A schedule is the delta pattern each stepped frame takes its time from.

```js
await hostCall(api, "setSchedule", { kind: "fixed", stepMs: 1000 / 120 });
await hostCall(api, "setSchedule", { kind: "sequence", stepsMs: [2, 8, 3, 5] });
await hostCall(api, "setSchedule", {
  kind: "jitter",
  minMs: 10,
  maxMs: 16,
  seed: 20250819,
});
```

Installing a schedule restarts it at its first step, so each drive walks the
same pattern from the same place however many frames preceded it. A jitter
schedule's `seed` is required, which is what makes a failing drive replayable
step for step.

A schedule is inert while the auto clock is driving, so a script may install one
before it takes the clock, or in a phase that must not consume time.

Reading `frame()` back confirms the schedule took effect. `lastDeltaMs` is the
delta the most recent frame was stepped by, so one step and one read is enough
to establish that the clock is walking the pattern that was installed:

```js
await hostCall(api, "setSchedule", { kind: "fixed", stepMs: 4 });
await hostCall(api, "advance", 1);
const info = await hostCall(api, "frame");
// info.lastDeltaMs === 4
```

An invalid schedule is refused where it is installed, naming the field and the
offending value, rather than producing a build that advances and never moves.

## One step is one frame

A step of `advance` is one scheduled frame under every schedule. The frame
counter is therefore schedule-independent: a check written as a number of ticks
counts the same thing under a fixed step, an uneven sequence, and a seeded
jitter. What the schedule changes is what each of those frames is worth in
simulated milliseconds, which `timeMs` reports as the running sum of the deltas
delivered.

Without an installed schedule the manual clock steps at `1000 / 120`
milliseconds. A case whose `tick_hz` is 120 therefore keeps its units under the
engine with no schedule of its own, and every tick count it already asserts on
continues to mean the same duration.

## Establishing delta-time independence

Driving one scenario under several schedules and comparing the outcomes is how a
case establishes that a build integrates against the delta time it is given
rather than against a count of frames. Pose the scenario, install a schedule,
run the real systems forward, and read the outcome back; then repeat from the
same pose under the next schedule.

```js
const SCHEDULES = [
  { id: "fixed", schedule: { kind: "fixed", stepMs: 1000 / 120 } },
  { id: "sequence", schedule: { kind: "sequence", stepsMs: [2, 8, 3, 5] } },
  {
    id: "jitter",
    schedule: { kind: "jitter", minMs: 10, maxMs: 16, seed: 20250819 },
  },
];

async function driveOnce(api, schedule) {
  await hostCall(api, "setSchedule", schedule);
  await poseScenario(api);
  const startMs = (await hostCall(api, "frame")).timeMs;
  const outcome = await runUntilResolved(api);
  outcome.elapsedMs = (await hostCall(api, "frame")).timeMs - startMs;
  return outcome;
}
```

The first drive is the reference and the rest are compared against it. Choose
schedules whose mean steps differ substantially from the reference's, because
that is what makes the comparison discriminating, and keep every step inside the
range of real frame rates so the comparison stays about step size rather than
about chaos.

Compare the elapsed game time and the outcomes that survive a change in step
size: whether an event occurred, which side scored, and the state the result
left behind. Exact positions and velocities diverge legitimately across step
sizes, so asserting on them fails honest builds.
[The Frame](/engines/simple-2d/concepts/frame/) covers why.

A run under `none` has no replaceable clock, so a comparison like this cannot be
posed at all. Detect the engine host and record an unmet precondition in that
case rather than a failure.
