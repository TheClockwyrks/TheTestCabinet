# The debug surface

A game's debug surface is the object it returns beside its state for posing a
scenario and reading it back from code. A caller holding it places the pieces
where it wants them, steps the simulation, and reads the outcome, so a build can
be driven without the keyboard and without waiting on real time.

```ts
initialize(api: InitApi): [S, D] | Promise<[S, D]>;
engine.debug: D;
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

## Returning it

`initialize` returns the state and the surface together, as the pair
`[state, debug]`. Building both in one place is what puts the surface in place
before any frame runs: a caller finds it as soon as `initialize` resolves, and
there is no moment at which the engine holds a state with no surface beside it.

```ts
import type { Game } from "@test-cabinet/simple-2d";

interface State {
  x: number;
  vx: number;
  bounces: number;
}

interface Debug {
  place(x: number, vx: number): void;
  bounces(): number;
}

const game: Game<State, Debug> = {
  initialize() {
    const state: State = { x: 320, vx: 0, bounces: 0 };

    const debug: Debug = {
      place(x, vx) {
        state.x = x;
        state.vx = vx;
      },
      bounces: () => state.bounces,
    };

    return [state, debug];
  },

  update(state, _api, dt) {
    state.x += state.vx * dt;
    if (state.x < 0 || state.x > 640) {
      state.x = Math.max(0, Math.min(640, state.x));
      state.vx = -state.vx;
      state.bounces += 1;
    }
  },

  render(state, api) {
    api.ctx.fillStyle = "#7fd1ff";
    api.ctx.fillRect(state.x - 12, 168, 24, 24);
  },
};
```

Close over the state the way a diagnostic source does, so the surface reports
what the game holds at the instant it is called. Offer the operations a
scenario is written in, such as placing a piece, forcing an outcome, or reading
a score, rather than the raw fields of the state.

The surface's implementation may live wherever the game likes — inline as above,
or in its own module that `initialize` builds and returns — so long as the pair
`initialize` returns carries it.

## Reading it back

`engine.debug` returns the value the game returned, unchanged, and the engine
handle is the whole route to it.

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

engine.debug.place(320, 480);
await engine.advance(120);

console.log(engine.debug.bounces());
```

Pair the surface with `advance` and a clock that supplies its own deltas: pose
the scenario, step an exact number of frames, and read the result back. See
`frame.md` for the clocks and for what a frame does.

## Errors

| Condition                                                        | Result                                                                |
| ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| `engine.debug` read before `initialize` resolves                 | `Error` naming the ordering and the `[state, debug]` pair             |
| The game's `initialize` returns anything but a two-element array | `initialize` rejects with an `Error` naming the `[state, debug]` pair |

Reading before `initialize` resolves throws exactly as `engine.state` does. A
game with no surface returns `null` there, and `engine.debug` hands that `null`
back rather than refusing: the surface is whatever the game chose, and `null` is
a choice the game can make.
