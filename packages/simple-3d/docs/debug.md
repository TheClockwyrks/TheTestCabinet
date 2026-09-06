# The debug surface

A game's debug surface is the object it returns beside its state for posing a
scenario and reading it back from code. A caller holding it places the pieces
where it wants them, steps the simulation, and reads the outcome, so a build can
be driven without the keyboard and without waiting on real time.

```ts
initialize(api: InitApi<S>): [S, D] | Promise<[S, D]>;
engine.debug: D;
engine.apply(transition: Transition<S>): DeepReadonly<S>;
engine.state: DeepReadonly<S>;
```

The engine holds whatever the game hands it. The shape is the game's own: the
methods it names, the values they return, and the vocabulary they use are the
game's design, and the engine reads no member of it.

## Declaring the surface

`Game`, `EngineOptions`, `Engine`, and `createEngine` each carry a second type
parameter alongside the state type. A game states its surface by declaring
`Game<State, Debug>`, and both parameters are inferred from the game the engine
options carry.

`D` defaults to `unknown`. A game with no surface declares `Game<State, null>`
and returns `[state, null]`.

## The shape of an operation

Nothing holds a writable state, so a surface's operations are written in the
shape of `update`: each takes the current state and returns something from it.

- A pose takes the current state and returns the next one. It is a
  `Transition<State>` plus the scalar arguments the pose needs, such as
  `setHookPosition(state, x, y, z) => State`.
- A reading takes the current state and returns what it read, such as
  `progress(state) => { placed: number; budget: number }`.

A caller drives a pose through `engine.apply` and a reading through
`engine.state`, so the surface itself holds no state and reports the state the
engine holds at the instant it is called.

A pose sets one element of the state and takes scalars or a small fixed tuple.
Keeping each element on its own operation lets a caller arrange exactly the part
of the world its scenario is about, and it leaves the game free to store that
element however it likes, because an operation that took an object of fields
would make the game's layout part of the surface.

**A pose acts on the state alone, never on the scene.** The scene is the picture
`render` builds from the state, so a posed scenario draws the same objects a
played one does as soon as the next frame runs, and a caller that wants the
picture calls `engine.advance(1)` after the pose.

## Returning it

`initialize` returns the state and the surface together, as the pair
`[state, debug]`. Building both in one place is what puts the surface in place
before any frame runs: a caller finds it as soon as `initialize` resolves, and
there is no moment at which the engine holds a state with no surface beside it.

```ts
import type { Game } from "@clockwyrks/simple-3d";
import type { DeepReadonly } from "ts-essentials";

interface Hook {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
}

interface State {
  readonly phase: "build" | "run" | "over";
  readonly hook: Hook;
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
  initialize(api) {
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

  update(state, _api, dt) {
    return step(state, dt);
  },

  render(state, api) {
    draw(api.scene, api.camera, api.screen, state);
  },
};
```

Offer one operation for each element of the world a scenario arranges: placing
the hook, giving it a velocity, setting the phase, spawning one load, clearing
the ones a scenario is not about, reading the score. A sequence that arranges
several of them at once, such as opening a site or staging a lift, belongs to
the caller, which composes it from these operations.

A reading returns a new value, because the state it is handed is read-only and a
plain object is what a caller compares and serializes.

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
```

The surface's implementation may live wherever the game likes, inline as above
or in its own module that `initialize` builds and returns, so long as the pair
`initialize` returns carries it. `version`, or any other plain property, stays a
plain property.

## Driving it

`engine.debug` returns the value the game returned, unchanged, and the engine
handle is the whole route to it. A pose is applied with `engine.apply`, which
replaces the state with the one the pose returns and hands the new state back; a
reading is given `engine.state`.

```ts
import { createEngine, ConstantClock } from "@clockwyrks/simple-3d";

const engine = createEngine({
  canvas,
  width: 1280,
  height: 720,
  game,
  clock: new ConstantClock(1000 / 60),
});

await engine.initialize();

engine.apply((s) => engine.debug.setHookPosition(s, 6, 12, 0));
engine.apply((s) => engine.debug.setHookVelocity(s, 0, -2, 0));
engine.apply((s) => engine.debug.setPhase(s, "run"));
await engine.advance(60);

console.log(engine.debug.progress(engine.state));
```

The next frame's `update` receives the state `apply` left. Pair the surface with
`advance` and a clock that supplies its own deltas: pose the scenario, step an
exact number of frames, and read the result back. See `frame.md` for the clocks
and for what a frame does.

Each pose is a transition the game's own systems could have produced, so a
scenario posed from code and the same scenario reached by playing leave the game
in one state.

## Beside the surface

A caller reads three other things off the same engine, and the surface does not
need to duplicate any of them.

- `engine.scene`, for the objects the build placed: `getObjectByName` finds one
  and its world position is read off it, with no pixels involved.
- `engine.view()`, for the camera's pose, and `ray` and `project` through it.
- `engine.diagnostics()`, for the values the build registered by name.

The surface is for what only the game can answer: posing its simulation, and
reading a figure the state holds that nothing else exposes.

## Errors

| Condition                                                        | Result                                                                |
| ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| `engine.debug` read before `initialize` resolves                 | `Error` naming the ordering and the `[state, debug]` pair             |
| `engine.apply` called before `initialize` resolves               | `Error` naming the ordering                                           |
| A transition handed to `engine.apply` returns `undefined`        | `Error` naming `engine.apply`; the engine keeps the state it had      |
| The game's `initialize` returns anything but a two-element array | `initialize` rejects with an `Error` naming the `[state, debug]` pair |

Reading before `initialize` resolves throws exactly as `engine.state` does. A
game with no surface returns `null` there, and `engine.debug` hands that `null`
back rather than refusing: the surface is whatever the game chose, and `null` is
a choice the game can make.
