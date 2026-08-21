# The debug surface

A game's debug surface is the object it hands the engine for posing a scenario
and reading it back from code. A caller holding it places the pieces where it
wants them, steps the simulation, and reads the outcome, so a build can be
driven without the keyboard and without waiting on real time.

```ts
api.debug.expose(surface: D): void;
engine.debug: D;
```

The engine holds whatever the game hands it. The shape is the game's own: the
methods it names, the values they return, and the vocabulary they use are the
game's design, and the engine reads no member of it.

## Declaring the surface

`Game`, `InitApi`, `EngineOptions`, `Engine`, and `createEngine` each carry a
second type parameter alongside the state type. A game states its surface by
declaring `Game<State, Debug>`, and both parameters are inferred from the game
the engine options carry.

`D` defaults to `unknown`. A game that exposes no surface names one type
parameter and never calls `expose`.

## Exposing it

The game calls `api.debug.expose` from `initialize`, which is the one place it
can. The surface is therefore in place before any frame runs, and a caller finds
it as soon as `initialize` resolves.

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
  initialize(api) {
    const state: State = { x: 320, vx: 0, bounces: 0 };

    api.debug.expose({
      place(x, vx) {
        state.x = x;
        state.vx = vx;
      },
      bounces: () => state.bounces,
    });

    return state;
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
what the game holds at the instant it is called. Expose the operations a
scenario is written in, such as placing a piece, forcing an outcome, or reading
a score, rather than the raw fields of the state.

## Reading it back

`engine.debug` returns the value the game exposed, unchanged, and the engine
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

| Condition | Result |
| --- | --- |
| `engine.debug` read before the game exposed a surface | `Error` naming the ordering |
| `expose` called a second time | `Error` naming the duplicate |

Reading before a surface exists throws exactly as `engine.state` does, so a game
that exposes none has no readable `engine.debug` rather than a value every
caller has to test. A second `expose` throws because a replaced surface would
leave a caller that already read `engine.debug` holding one the game had
abandoned.
