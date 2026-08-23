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
  `Transition<State>` plus whatever arguments the pose needs, such as
  `serve(state) => State` or `setBall(state, index, patch) => State`.
- A reading takes the current state and returns what it read, such as
  `snapshot(state) => Snapshot`.

A caller drives a pose through `engine.apply` and a reading through
`engine.state`, so the surface itself holds no state and reports the state the
engine holds at the instant it is called.

## Returning it

`initialize` returns the state and the surface together, as the pair
`[state, debug]`. Building both in one place is what puts the surface in place
before any frame runs: a caller finds it as soon as `initialize` resolves, and
there is no moment at which the engine holds a state with no surface beside it.

```ts
import type { Game } from "@test-cabinet/simple-2d";
import type { DeepReadonly } from "ts-essentials";

interface State {
  readonly x: number;
  readonly vx: number;
  readonly bounces: number;
}

interface Debug {
  place(state: DeepReadonly<State>, x: number, vx: number): State;
  bounces(state: DeepReadonly<State>): number;
}

const game: Game<State, Debug> = {
  initialize() {
    const state: State = { x: 320, vx: 0, bounces: 0 };

    const debug: Debug = {
      place: (s, x, vx) => ({ ...s, x, vx }),
      bounces: (s) => s.bounces,
    };

    return [state, debug];
  },

  update(state, _api, dt) {
    const x = state.x + state.vx * dt;
    if (x < 0 || x > 640) {
      return {
        ...state,
        x: Math.max(0, Math.min(640, x)),
        vx: -state.vx,
        bounces: state.bounces + 1,
      };
    }
    return { ...state, x };
  },

  render(state, api) {
    api.ctx.fillStyle = "#7fd1ff";
    api.ctx.fillRect(state.x - 12, 168, 24, 24);
  },
};
```

Offer the operations a scenario is written in, such as placing a piece, forcing
an outcome, or reading a score, rather than the raw fields of the state.

The surface's implementation may live wherever the game likes, inline as above
or in its own module that `initialize` builds and returns, so long as the pair
`initialize` returns carries it. `version`, or any other plain property, stays a
plain property.

## Driving it

`engine.debug` returns the value the game returned, unchanged, and the engine
handle is the whole route to it. A pose is applied with `engine.apply`, which
replaces the state with the one the pose returns and hands the new state back;
a reading is given `engine.state`.

```ts
import { createEngine, ConstantClock } from "@test-cabinet/simple-2d";

const engine = createEngine({
  canvas,
  width: 640,
  height: 360,
  game,
  clock: new ConstantClock(1000 / 60),
});

await engine.initialize();

engine.apply((s) => engine.debug.place(s, 320, 480));
await engine.advance(120);

console.log(engine.debug.bounces(engine.state));
```

The next frame's `update` receives the state `apply` left. Pair the surface
with `advance` and a clock that supplies its own deltas: pose the scenario, step
an exact number of frames, and read the result back. See `frame.md` for the
clocks and for what a frame does.

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
