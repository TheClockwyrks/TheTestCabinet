---
title: Debug Surface
---

A build hands the engine one object a caller drives it through. The game builds
that surface in `initialize` and returns it beside the state as the pair
`[state, debug]`, and the engine returns the surface unchanged from
`engine.debug`. A caller poses a scenario through it, steps the simulation, and
reads the outcome back, with no keyboard and no waiting on real time.

The surface holds no state of its own. Its operations are written in the shape
of `update`: a pose takes the current state and returns the next, and a reading
takes the current state and returns what it read. A caller drives a pose through
`engine.apply` and a reading through `engine.state`.

```ts
import type { Game } from "@clockwyrks/simple-3d";
import type { DeepReadonly } from "ts-essentials";

interface State {
  readonly phase: "build" | "run" | "over";
  readonly hook: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly vx: number;
    readonly vy: number;
    readonly vz: number;
  };
  readonly placed: number;
  readonly budget: number;
}

interface Debug {
  setHookPosition(
    state: DeepReadonly<State>,
    x: number,
    y: number,
    z: number,
  ): State;
  setHookVelocity(
    state: DeepReadonly<State>,
    vx: number,
    vy: number,
    vz: number,
  ): State;
  setPhase(state: DeepReadonly<State>, phase: State["phase"]): State;
  phase(state: DeepReadonly<State>): State["phase"];
  progress(state: DeepReadonly<State>): { placed: number; budget: number };
}

const game: Game<State, Debug> = {
  initialize() {
    const state: State = {
      phase: "build",
      hook: { x: 0, y: 12, z: 0, vx: 0, vy: 0, vz: 0 },
      placed: 0,
      budget: 5000,
    };

    const debug: Debug = {
      setHookPosition: (s, x, y, z) => ({ ...s, hook: { ...s.hook, x, y, z } }),
      setHookVelocity: (s, vx, vy, vz) => ({
        ...s,
        hook: { ...s.hook, vx, vy, vz },
      }),
      setPhase: (s, phase) => ({ ...s, phase }),
      phase: (s) => s.phase,
      progress: (s) => ({ placed: s.placed, budget: s.budget }),
    };

    return [state, debug];
  },
  update(state, api, dt) {
    return step(state, dt);
  },
  render(state, api) {
    draw(api.scene, api.camera, api.screen, state);
  },
};
```

A pose is a `Transition<State>` with arguments in front of it, and the engine
keeps the value it returns as the state the next frame's `update` receives. A
reading is handed the value current at the call, so it reports what the game
holds at that instant.

```ts
await engine.initialize();

engine.apply((s) => engine.debug.setHookPosition(s, 6, 12, 0));
engine.apply((s) => engine.debug.setHookVelocity(s, 0, -2, 0));
engine.apply((s) => engine.debug.setPhase(s, "run"));
await engine.advance(60);

const progress = engine.debug.progress(engine.state);
```

## Declaring the type

`Game` takes the surface as a second type parameter alongside the state, and
`createEngine` infers both from the game the options carry. `D` defaults to
`unknown`. A game with no surface writes `Game<State, null>` and returns
`[state, null]`.

The engine holds the value and reads no member of it. The methods, their
signatures, and the vocabulary they use are the game's own design.

## What belongs on it

Offer one operation for each element a scenario arranges: placing the hook,
giving it a velocity, setting the phase, spawning one load, clearing the ones a
scenario is not about, reading the score. Each pose takes scalars or a small
fixed tuple rather than an object of fields, which keeps the game's own layout
out of the surface and lets a caller arrange exactly the part its scenario
concerns. A sequence that arranges several elements at once, such as opening a
site, is composed by the caller from these operations.

Each pose is a transition the game's own systems could have produced, so a
scenario posed from code and the same scenario reached by playing leave the game
in one state. The surface acts on the state alone; the scene is the picture
`render` builds from that state, so a posed scenario draws the same objects a
played one does once the next frame runs.

A diagnostic source names one value, of the types the overlay draws; the surface
names the operations a caller drives from code, and the readings it needs to
decide what happened. A reading returns a new value, because the state it is
handed is read-only and a plain object is what a caller compares and serializes.

```ts
const debug: Debug = {
  spawnLoad: (s, mass, x, z) => ({
    ...s,
    loads: [...s.loads, makeLoad(mass, x, z)],
  }),
  clearLoads: (s) => ({ ...s, loads: [] }),
  waiting: (s) => s.loads.length,
  progress: (s) => ({ placed: s.placed, budget: s.budget }),
};

return [state, debug];
```

## Returning it

`initialize` returns the state and the surface as one pair, so the surface is
in place before the first frame and a caller finds it the moment
`engine.initialize` resolves. Every caller that reads `engine.debug` holds the
same object.

The surface's implementation may live wherever the game likes, inline as above
or in its own module of pure functions that `initialize` gathers, so long as the
pair `initialize` returns carries it. A return that is anything but a
two-element array rejects `initialize` with an error naming the pair.

Reading `engine.debug` before `initialize` resolves throws, naming the ordering
and the pair, exactly as `engine.state` and `engine.apply` do.

## The case's contract

A case that checks a build through the engine specifies the surface in its
instrumentation spec, and the build writes it: `initialize` builds the surface
and returns the two together. The validators reach the surface only through
`engine.debug`, declaring their own type for it from the spec, and drive it
through `engine.apply` and `engine.state`. What a check reads beside the
surface, the scene, the view, and the screen layer, is covered at
[Simulation](/engines/simple-3d/validators/simulation/), and the module paths a
case fixes are at [The Suite](/engines/simple-3d/validators/the-suite/).
